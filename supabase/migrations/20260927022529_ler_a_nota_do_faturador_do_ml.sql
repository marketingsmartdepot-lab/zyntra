-- A nota que o Faturador do Mercado Livre emitiu, lida de volta.
--
-- É ela que move o pacote de Aberto para Faturado — `reavaliar_pacote` exige
-- nota AUTORIZADA para todos os pedidos da caixa. Sem isto a esteira nunca
-- anda, por mais pedidos que entrem.
--
-- Contrato (documentação do ML, conferida em 27/09/2026):
--   GET /users/{user_id}/invoices/orders/{order_id}
--   devolve status, invoice_series, invoice_number, issued_date e
--   attributes.authorization_date. O XML sai por outro endereço, com o
--   invoice_id.
--
-- 404 é o caso NORMAL enquanto o ML não emitiu. Tratar como erro encheria a
-- tela de falhas que não são falhas.

create or replace function privado.buscar_nota_do_pedido(p_pedido_id uuid)
returns table(ok boolean, motivo text, situacao text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_p record;
  v_token text;
  v_r extensions.http_response;
  v_j jsonb;
  v_status text;
  v_situacao public.nota_situacao;
  v_pacote uuid;
begin
  select pd.id, pd.ref_externa, pd.conta_id, ct.ref_externa as user_id
    into v_p
  from public.pedidos pd
  join public.contas ct on ct.id = pd.conta_id
  where pd.id = p_pedido_id;

  if not found or coalesce(v_p.user_id, '') = '' then
    return query select false, 'pedido_ou_conta_invalido', null::text; return;
  end if;

  select t.token into v_token from privado.token_ml(v_p.conta_id) t;
  if coalesce(v_token, '') = '' then
    return query select false, 'sem_conexao', null::text; return;
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '4000');
    select * into v_r from extensions.http((
      'GET',
      'https://api.mercadolibre.com/users/' || extensions.urlencode(v_p.user_id)
        || '/invoices/orders/' || extensions.urlencode(v_p.ref_externa),
      array[
        extensions.http_header('Accept', 'application/json'),
        extensions.http_header('Authorization', 'Bearer ' || v_token)
      ],
      null, null
    )::extensions.http_request);
  exception when others then
    return query select false, 'rede', null::text; return;
  end;

  -- Ainda não emitiu. Não é falha: é o estado normal de um pedido novo.
  if v_r.status = 404 then
    return query select true, 'ainda_sem_nota', null::text; return;
  end if;

  if v_r.status < 200 or v_r.status > 299 then
    return query select false,
      case when v_r.status = 401 then 'conexao_recusada'
           when v_r.status = 429 then 'ml_pediu_calma'
           else 'recusado' end,
      null::text; return;
  end if;

  v_j := v_r.content::jsonb;
  v_status := lower(coalesce(v_j->>'status', v_j->>'transaction_status', ''));

  v_situacao := case
    when v_status in ('authorized', 'authorised') then 'autorizada'
    when v_status in ('cancelled', 'canceled') then 'cancelada'
    when v_status in ('rejected', 'error', 'denied') then 'rejeitada'
    else 'solicitada'
  end::public.nota_situacao;

  select pa.id into v_pacote
  from public.pacotes pa
  join public.pedidos pd on pd.envio_id = pa.envio_id
  where pd.id = p_pedido_id;

  insert into public.notas_fiscais as nf
    (conta_id, pacote_id, pedido_id, chave_idempotencia, pedidos_ref,
     tipo, situacao, ref_externa, status_canal, serie, numero,
     autorizada_em, erro_codigo, erro_mensagem, atualizado_em)
  values (
    v_p.conta_id, v_pacote, p_pedido_id,
    'ml:' || v_p.conta_id::text || ':' || v_p.ref_externa,
    array[v_p.ref_externa],
    'venda', v_situacao,
    v_j->>'id', v_status,
    nullif(v_j->>'invoice_series', ''),
    nullif(v_j->>'invoice_number', '')::bigint,
    coalesce(
      nullif(v_j#>>'{attributes,authorization_date}','')::timestamptz,
      case when v_situacao = 'autorizada'
           then nullif(v_j->>'issued_date','')::timestamptz end),
    case when v_situacao = 'rejeitada' then v_j#>>'{attributes,error_code}' end,
    case when v_situacao = 'rejeitada'
         then coalesce(v_j#>>'{attributes,error_message}', v_j->>'message') end,
    now())
  on conflict (chave_idempotencia) do update
    set pacote_id = coalesce(excluded.pacote_id, nf.pacote_id),
        pedido_id = coalesce(excluded.pedido_id, nf.pedido_id),
        situacao = excluded.situacao,
        ref_externa = coalesce(excluded.ref_externa, nf.ref_externa),
        status_canal = excluded.status_canal,
        serie = coalesce(excluded.serie, nf.serie),
        numero = coalesce(excluded.numero, nf.numero),
        autorizada_em = coalesce(excluded.autorizada_em, nf.autorizada_em),
        erro_codigo = excluded.erro_codigo,
        erro_mensagem = excluded.erro_mensagem,
        atualizado_em = now();

  -- A nota mudou de estado: o bloqueio fiscal pode ter deixado de existir, e
  -- é o diagnóstico que fecha e manda o pacote andar.
  if v_pacote is not null then
    perform public.diagnosticar_pacote(v_pacote);
  end if;

  return query select true, 'ok', v_situacao::text;
end;
$$;

/**
 * A varredura das notas. Procura pedido de caixa parada em Aberto que ainda
 * não tem nota autorizada e pergunta ao ML.
 *
 * Separada da varredura de pedidos de propósito: a nota demora, e reperguntar
 * a nota de todo pedido a cada volta seria uma chamada por pedido aberto, a
 * cada cinco minutos. Aqui o teto é explícito.
 */
create or replace function public.varrer_notas_ml(p_limite integer default 40)
returns table(consultados integer, autorizadas integer, sem_nota integer, falhas integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ped record;
  v_r record;
  n_con integer := 0; n_aut integer := 0; n_sem integer := 0; n_fal integer := 0;
begin
  for v_ped in
    select pd.id
    from public.pedidos pd
    join public.pacotes pa on pa.envio_id = pd.envio_id
    join public.contas ct on ct.id = pd.conta_id
    join public.canais ca on ca.id = ct.canal_id
    where ca.slug = 'mercado_livre'
      and ct.situacao = 'conectada'
      and pa.etapa = 'aberto'
      and not exists (
        select 1 from public.notas_fiscais nf
        where nf.pedido_id = pd.id and nf.situacao = 'autorizada'
      )
    order by pd.criado_no_canal_em
    limit greatest(coalesce(p_limite, 40), 1)
  loop
    n_con := n_con + 1;
    begin
      select * into v_r from privado.buscar_nota_do_pedido(v_ped.id);
      if not v_r.ok then
        n_fal := n_fal + 1;
      elsif v_r.motivo = 'ainda_sem_nota' then
        n_sem := n_sem + 1;
      elsif v_r.situacao = 'autorizada' then
        n_aut := n_aut + 1;
      end if;
    exception when others then
      n_fal := n_fal + 1;
    end;
  end loop;

  return query select n_con, n_aut, n_sem, n_fal;
end;
$$;

revoke all on function public.varrer_notas_ml(integer) from public, anon, authenticated;

-- De 5 em 5 minutos, deslocado da varredura de pedidos para as duas não
-- disputarem a mesma janela.
select cron.schedule(
  'zyntra-notas-ml',
  '2-59/5 * * * *',
  $cron$ select public.varrer_notas_ml() $cron$
);
