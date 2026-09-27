-- A etiqueta do Mercado Livre, guardada aqui.
--
-- O ML entrega a etiqueta dentro de um ZIP, mesmo quando se pede ZPL — testado
-- três vezes, com zpl2, zpl e sem formato: as três voltaram application/zip.
-- O banco não descompacta ZIP, então este é o primeiro passo da integração que
-- não cabe nele. Quem abre o envelope é o ZYNTRA, pelo mesmo caminho que a
-- baixa de estoque já usa: pg_net manda, um coletor lê a resposta depois.
--
-- O token do ML viaja no corpo da chamada, de propósito: é a alternativa a dar
-- ao app uma chave de banco. Um token de uma conta, que dura 6 horas, é um
-- estrago menor que acesso total ao banco.

create table if not exists privado.config (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);

revoke all on table privado.config from anon, authenticated;

-- Os valores (app_url e segredo_interno) entram por fora, não por migração:
-- segredo em arquivo versionado é segredo publicado.

alter table public.envios
  add column if not exists etiqueta_conteudo text,
  add column if not exists etiqueta_formato text,
  add column if not exists etiqueta_request_id bigint,
  add column if not exists etiqueta_pedida_em timestamptz,
  add column if not exists etiqueta_erro text;

comment on column public.envios.etiqueta_conteudo is
  'O ZPL da etiqueta, já desembrulhado. É este texto que vai para a Zebra — '
  'o agente nunca fala com o Mercado Livre.';

/**
 * Pede a etiqueta das caixas que já podem imprimir.
 *
 * O ML só entrega quando o envio está ready_to_ship + ready_to_print. Pedir
 * antes devolve erro, e é por isso que a aba Faturado existe: ela é a sala de
 * espera da etiqueta.
 */
create or replace function public.pedir_etiquetas_ml(p_limite integer default 20)
returns table(pedidas integer, sem_endereco boolean)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_base text;
  v_segredo text;
  v_e record;
  v_token text;
  v_req bigint;
  n integer := 0;
begin
  select c.valor into v_base from privado.config c where c.chave = 'app_url';
  select c.valor into v_segredo from privado.config c where c.chave = 'segredo_interno';

  if coalesce(v_base, '') = '' or coalesce(v_segredo, '') = '' then
    return query select 0, true; return;
  end if;

  for v_e in
    select e.id, e.ref_externa, e.conta_id
    from public.envios e
    join public.pacotes pa on pa.envio_id = e.id
    join public.contas ct on ct.id = e.conta_id
    join public.canais ca on ca.id = ct.canal_id
    where ca.slug = 'mercado_livre'
      and ct.situacao = 'conectada'
      and pa.etapa in ('faturado', 'separar', 'conferir')
      and e.etiqueta_conteudo is null
      -- O ML só entrega nestes estados. Pedir fora deles é gastar chamada
      -- para receber erro.
      and e.situacao_canal = 'ready_to_ship'
      and coalesce(e.substatus_canal, '') in ('ready_to_print', 'printed')
      -- Não repetir enquanto a resposta anterior não voltou.
      and (e.etiqueta_pedida_em is null
           or e.etiqueta_pedida_em < now() - interval '10 minutes')
    order by e.etiqueta_pedida_em nulls first
    limit greatest(coalesce(p_limite, 20), 1)
  loop
    select t.token into v_token from privado.token_ml(v_e.conta_id) t;
    continue when coalesce(v_token, '') = '';

    select net.http_post(
      url := v_base || '/api/ml/etiquetas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-zyntra-segredo', v_segredo
      ),
      body := jsonb_build_object(
        'envio_id', v_e.id,
        'shipment_id', v_e.ref_externa,
        'token', v_token
      ),
      timeout_milliseconds := 20000
    ) into v_req;

    update public.envios e
       set etiqueta_request_id = v_req,
           etiqueta_pedida_em = now(),
           etiqueta_erro = null
     where e.id = v_e.id;

    n := n + 1;
  end loop;

  return query select n, false;
end;
$$;

/**
 * Lê o que o ZYNTRA respondeu e guarda a etiqueta.
 *
 * Com a etiqueta na mão, a caixa deixa de estar esperando: Faturado é a sala
 * de espera da etiqueta, e quem já tem a etiqueta vai para Separar.
 */
create or replace function public.coletar_etiquetas_ml()
returns table(guardadas integer, falhas integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_r record;
  n_ok integer := 0; n_erro integer := 0;
begin
  for v_r in
    select e.id as envio_id, r.status_code, r.content
    from public.envios e
    join net._http_response r on r.id = e.etiqueta_request_id
    where e.etiqueta_conteudo is null
      and e.etiqueta_request_id is not null
  loop
    if v_r.status_code between 200 and 299
       and coalesce((v_r.content::jsonb)->>'conteudo', '') <> '' then

      update public.envios e
         set etiqueta_conteudo = (v_r.content::jsonb)->>'conteudo',
             etiqueta_formato = coalesce((v_r.content::jsonb)->>'formato', 'zpl'),
             etiqueta_obtida_em = now(),
             etiqueta_request_id = null,
             etiqueta_erro = null,
             atualizado_em = now()
       where e.id = v_r.envio_id;

      n_ok := n_ok + 1;
    else
      update public.envios e
         set etiqueta_request_id = null,
             etiqueta_erro = 'ZYNTRA respondeu ' || coalesce(v_r.status_code::text, '?')
                             || ': ' || left(coalesce(v_r.content, ''), 200)
       where e.id = v_r.envio_id;

      n_erro := n_erro + 1;
    end if;
  end loop;

  -- Com etiqueta na mão, a caixa sai da sala de espera.
  update public.pacotes pa
     set etapa = 'separar', etapa_anterior = pa.etapa, etapa_desde = now(),
         atualizado_em = now()
   from public.envios e
  where e.id = pa.envio_id
    and pa.etapa = 'faturado'
    and e.etiqueta_conteudo is not null
    and not exists (
      select 1 from public.bloqueios b
      where b.pacote_id = pa.id and b.resolvido_em is null
    );

  return query select n_ok, n_erro;
end;
$$;

revoke all on function public.pedir_etiquetas_ml(integer) from public, anon, authenticated;
revoke all on function public.coletar_etiquetas_ml() from public, anon, authenticated;

-- Espalhados pelos minutos para não disputarem a mesma janela. O coletor roda
-- ANTES do pedido: ele recolhe as respostas da rodada anterior, que já
-- chegaram, em vez de esperar as que acabaram de sair.
select cron.schedule('zyntra-etiquetas-coletar', '1-59/5 * * * *',
  $c$ select public.coletar_etiquetas_ml() $c$);
select cron.schedule('zyntra-etiquetas-pedir', '3-59/5 * * * *',
  $c$ select public.pedir_etiquetas_ml() $c$);
