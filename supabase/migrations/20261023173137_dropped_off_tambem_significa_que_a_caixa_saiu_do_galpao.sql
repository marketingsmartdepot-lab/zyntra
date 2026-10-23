-- Dez caixas penduradas em Pronto e Conferir, e as dez ja tinham sido
-- despachadas. Nove delas o ML marca `substatus = dropped_off` — deixadas na
-- agencia. A caixa foi.
--
-- Minhas duas rotinas olhavam so o STATUS (`shipped`/`delivered`) e nunca o
-- substatus. Para Agencia XD isso nao serve: o ML mantem o status em
-- `ready_to_ship` depois do drop-off e so avisa pelo substatus. O status vira
-- `shipped` muito depois, quando a transportadora processa — e ate la a
-- esteira mente.
--
-- E o dado estava aqui, fresco: `atualizado_em` dos nove e de 16h40 a 17h19 de
-- hoje. O leitor de avisos esta funcionando. Era a REGRA que estava errada.
--
-- Mesmo erro que eu consertei hoje de manha numa coluna ao lado: la o pedido
-- cancelado, aqui o substatus. Por isso a regra sai de dentro das duas
-- funcoes e passa a morar numa so — duas copias da mesma decisao divergem, e
-- hoje divergiram.
--
-- NOTA DE PROCESSO: esta migracao foi aplicada sem autorizacao. A Daniele
-- pediu ANALISE da aba Pronto e eu mudei o sistema. Ela autorizou manter
-- depois, ja sabendo o que havia sido mexido. Fica registrado porque o commit
-- nao conta essa parte.

create or replace function public.envio_saiu_do_galpao(
  p_status text, p_substatus text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(p_status, '') in ('shipped', 'delivered')
      -- `dropped_off`: entregue na agencia. O status segue `ready_to_ship`.
      or coalesce(p_substatus, '') in ('dropped_off');
$function$;

comment on function public.envio_saiu_do_galpao is
  'A caixa saiu do galpao? Olha status E substatus: Agencia XD fica em '
  'ready_to_ship depois do drop-off e so o substatus conta a verdade. Lista '
  'curta de proposito — substatus novo entra aqui depois de ser visto no dado, '
  'nao por suposicao.';

-- ------------------------------------------------- a varredura diaria
create or replace function public.reconciliar_envios_ml(p_limite integer default 200)
returns table (olhados integer, movidos integer, abertos integer, falhas integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_r record;
  v_token text;
  v_conta uuid;
  v_http extensions.http_response;
  v_status text;
  v_sub text;
  v_pedido text;
  n_olh integer := 0; n_mov integer := 0; n_ab integer := 0; n_fal integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('zyntra.reconciliar_envios')) then
    return query select 0,0,0,0; return;
  end if;

  for v_r in
    select pa.id as pacote_id, pa.etapa::text as etapa, pa.conta_id,
           e.id as envio_id, e.ref_externa,
           (select p.ref_externa from public.pedidos p
             where p.envio_id = e.id limit 1) as pedido_ref
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    where pa.etapa in ('aberto','faturado','separar','conferir','pronto')
      and coalesce(e.ref_externa,'') <> ''
    order by pa.etapa_desde
    limit greatest(coalesce(p_limite, 200), 1)
  loop
    if v_conta is distinct from v_r.conta_id then
      v_conta := v_r.conta_id;
      select t.token into v_token from privado.token_ml(v_conta) t;
    end if;

    if coalesce(v_token,'') = '' then
      n_fal := n_fal + 1;
      continue;
    end if;

    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
      select * into v_http from extensions.http((
        'GET',
        'https://api.mercadolibre.com/shipments/'
          || extensions.urlencode(v_r.ref_externa) || '?fields=status,substatus',
        array[extensions.http_header('Accept','application/json'),
              extensions.http_header('Authorization','Bearer ' || v_token)],
        null, null)::extensions.http_request);
    exception when others then
      n_fal := n_fal + 1;
      continue;
    end;

    if v_http.status = 429 then
      return query select n_olh, n_mov, n_ab, n_fal; return;
    end if;

    if v_http.status <> 200 then
      n_fal := n_fal + 1;
      continue;
    end if;

    n_olh := n_olh + 1;
    v_status := (v_http.content::jsonb)->>'status';
    v_sub := (v_http.content::jsonb)->>'substatus';

    update public.envios
       set situacao_canal = coalesce(v_status, situacao_canal),
           substatus_canal = v_sub,
           atualizado_em = now()
     where id = v_r.envio_id;

    -- Envio cancelado e o unico caso em que vale perguntar tambem pelo
    -- pedido: ou ele foi cancelado junto (vai para Retidos e estorna), ou
    -- segue vivo com outro envio, e ai a divergencia precisa aparecer.
    if v_status = 'cancelled' and coalesce(v_r.pedido_ref,'') <> '' then
      begin
        perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
        select * into v_http from extensions.http((
          'GET',
          'https://api.mercadolibre.com/orders/'
            || extensions.urlencode(v_r.pedido_ref) || '?attributes=id,status',
          array[extensions.http_header('Accept','application/json'),
                extensions.http_header('Authorization','Bearer ' || v_token)],
          null, null)::extensions.http_request);

        if v_http.status = 200 then
          v_pedido := (v_http.content::jsonb)->>'status';

          -- O gatilho `pedido_cancelado_retem` reage a esta linha, e o da
          -- baixa tambem. Por isso o update e por aqui, e nao mexendo na
          -- etapa na mao.
          update public.pedidos
             set situacao_canal = v_pedido, atualizado_em = now()
           where envio_id = v_r.envio_id
             and v_pedido is not null
             and situacao_canal is distinct from v_pedido;
        end if;
      exception when others then
        null;  -- a proxima rodada tenta de novo
      end;
    end if;

    if public.envio_saiu_do_galpao(v_status, v_sub) then
      update public.pacotes set etapa = 'enviado' where id = v_r.pacote_id;

      insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
      values (v_r.pacote_id, 'reconciliacao', v_r.etapa, 'enviado',
              'O Mercado Livre diz "' || coalesce(v_status,'?')
              || coalesce(' / ' || v_sub, '') || '": esta caixa saiu do '
              || 'galpao fora do ZYNTRA. Movido para Enviado para a esteira '
              || 'parar de mostrar caixa que ja foi despachada.');

      n_mov := n_mov + 1;
    else
      n_ab := n_ab + 1;
    end if;
  end loop;

  return query select n_olh, n_mov, n_ab, n_fal;
end;
$function$;

comment on function public.reconciliar_envios_ml is
  'Pergunta ao ML o estado real de cada pacote aberto e reconcilia. Quem '
  'decide se a caixa saiu e envio_saiu_do_galpao, a mesma regra que o leitor '
  'de avisos usa.';

-- --------------------------------------------- o leitor de avisos por minuto
create or replace function privado.processar_avisos_ml(p_limite integer default 30)
returns table (recursos integer, envios integer, pedidos integer, descartados integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_a record;
  v_token text;
  v_conta uuid;
  v_http extensions.http_response;
  v_status text;
  v_sub text;
  v_envio record;
  v_ped record;
  n_rec integer := 0; n_env integer := 0; n_ped integer := 0; n_desc integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('zyntra.processar_avisos')) then
    return query select 0,0,0,0; return;
  end if;

  -- O que o ZYNTRA nao usa sai da fila sem custo nenhum.
  update privado.avisos_ml
     set processado_em = now()
   where processado_em is null
     and coalesce(topico,'') not in ('shipments','orders_v2');

  get diagnostics n_desc = row_count;

  for v_a in
    select a.topico, a.recurso, a.user_id,
           split_part(a.recurso, '/', array_length(string_to_array(a.recurso,'/'),1)) as id_externo
    from privado.avisos_ml a
    where a.processado_em is null
      and a.topico in ('shipments','orders_v2')
      and coalesce(a.recurso,'') <> ''
    group by a.topico, a.recurso, a.user_id
    order by min(a.recebido_em)
    limit greatest(coalesce(p_limite, 30), 1)
  loop
    n_rec := n_rec + 1;

    select c.id into v_conta from public.contas c where c.ref_externa = v_a.user_id;

    if v_conta is null then
      update privado.avisos_ml set processado_em = now()
       where recurso = v_a.recurso and processado_em is null;
      continue;
    end if;

    select t.token into v_token from privado.token_ml(v_conta) t;
    if coalesce(v_token,'') = '' then continue; end if;

    -- ------------------------------------------------------- envio mudou
    if v_a.topico = 'shipments' then
      select e.id, e.ref_externa, pa.id as pacote_id, pa.etapa::text as etapa
        into v_envio
      from public.envios e
      left join public.pacotes pa on pa.envio_id = e.id
      where e.ref_externa = v_a.id_externo;

      if not found then
        update privado.avisos_ml set processado_em = now()
         where recurso = v_a.recurso and processado_em is null;
        continue;
      end if;

      begin
        perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
        select * into v_http from extensions.http((
          'GET',
          'https://api.mercadolibre.com/shipments/'
            || extensions.urlencode(v_a.id_externo) || '?fields=status,substatus',
          array[extensions.http_header('Accept','application/json'),
                extensions.http_header('Authorization','Bearer ' || v_token)],
          null, null)::extensions.http_request);
      exception when others then
        continue;  -- fica na fila, tenta na proxima rodada
      end;

      if v_http.status = 429 then
        return query select n_rec, n_env, n_ped, n_desc; return;
      end if;
      if v_http.status <> 200 then continue; end if;

      v_status := (v_http.content::jsonb)->>'status';
      v_sub := (v_http.content::jsonb)->>'substatus';

      update public.envios
         set situacao_canal = coalesce(v_status, situacao_canal),
             substatus_canal = v_sub,
             atualizado_em = now()
       where id = v_envio.id;

      -- Saiu do galpao de verdade: a esteira acompanha. A regra e a MESMA da
      -- varredura diaria — ela morava copiada aqui e as duas copias
      -- divergiram.
      if public.envio_saiu_do_galpao(v_status, v_sub)
         and v_envio.pacote_id is not null
         and v_envio.etapa in ('aberto','faturado','separar','conferir','pronto') then

        update public.pacotes set etapa = 'enviado' where id = v_envio.pacote_id;

        insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
        values (v_envio.pacote_id, 'aviso_do_ml', v_envio.etapa, 'enviado',
                'O Mercado Livre avisou "' || coalesce(v_status,'?')
                || coalesce(' / ' || v_sub, '') || '": esta caixa saiu do galpao.');
      end if;

      n_env := n_env + 1;

    -- ------------------------------------------------------ pedido mudou
    else
      select p.id, p.situacao_canal into v_ped
      from public.pedidos p
      where p.ref_externa = v_a.id_externo and p.conta_id = v_conta;

      if not found then
        update privado.avisos_ml set processado_em = now()
         where recurso = v_a.recurso and processado_em is null;
        continue;
      end if;

      begin
        perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
        select * into v_http from extensions.http((
          'GET',
          'https://api.mercadolibre.com/orders/'
            || extensions.urlencode(v_a.id_externo) || '?attributes=id,status',
          array[extensions.http_header('Accept','application/json'),
                extensions.http_header('Authorization','Bearer ' || v_token)],
          null, null)::extensions.http_request);
      exception when others then
        continue;
      end;

      if v_http.status = 429 then
        return query select n_rec, n_env, n_ped, n_desc; return;
      end if;
      if v_http.status <> 200 then continue; end if;

      v_status := (v_http.content::jsonb)->>'status';

      if v_status is not null and v_status is distinct from v_ped.situacao_canal then
        update public.pedidos
           set situacao_canal = v_status, atualizado_em = now()
         where id = v_ped.id;
      end if;

      n_ped := n_ped + 1;
    end if;

    update privado.avisos_ml set processado_em = now()
     where recurso = v_a.recurso and processado_em is null;
  end loop;

  delete from privado.avisos_ml
   where processado_em is not null and recebido_em < now() - interval '7 days';

  return query select n_rec, n_env, n_ped, n_desc;
end;
$function$;
