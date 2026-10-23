-- A esteira estava mentindo: 150 pacotes parados em Faturado, Separar e
-- Conferir, e os 12 mais antigos que amostrei estavam TODOS entregues no ML.
-- Um deles saiu do galpão em 30/09 e foi entregue em 02/10 — o ZYNTRA mostrava
-- `pending/buffered` desde 28/09.
--
-- Duas falhas somadas, e nenhuma dava erro:
--
-- 1. O ML avisa toda mudança por webhook, e os avisos CHEGAM — 30.227 deles,
--    963 por dia, sendo 2.292 de `shipments`. Mas existe uma única função
--    tocando `privado.avisos_ml` e ela só GRAVA. Nenhum leitor, nenhum cron,
--    ZERO processados. Uma caixa de entrada que ninguém nunca abriu, já com
--    20 MB — 29% do banco.
--
-- 2. O que sobrou para atualizar status é `varrer_pedidos_ml`, e ela pergunta
--    ao ML só o que mudou nas ÚLTIMAS 2 HORAS. Pedido de setembro é visto nas
--    primeiras horas e nunca mais: o `situacao_canal` congela e fica congelado.
--
-- Como o galpão também nunca moveu nada por dentro (zero listas, zero saídas),
-- o pacote congela no estágio onde estava e mora lá para sempre.
--
-- Esta função pergunta ao ML o estado real de cada pacote ainda aberto e
-- reconcilia. Ela NÃO move no escuro: só o que o ML disser `delivered` ou
-- `shipped` vai para Enviado — o que ainda está em andamento fica onde está.
-- E corrige `situacao_canal` de todos, para a tela parar de mentir mesmo
-- quando o pacote continua aberto.

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
  n_olh integer := 0; n_mov integer := 0; n_ab integer := 0; n_fal integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('zyntra.reconciliar_envios')) then
    return query select 0,0,0,0; return;
  end if;

  for v_r in
    select pa.id as pacote_id, pa.etapa::text as etapa, pa.conta_id,
           e.id as envio_id, e.ref_externa
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    where pa.etapa in ('aberto','faturado','separar','conferir','pronto')
      and coalesce(e.ref_externa,'') <> ''
    order by pa.etapa_desde
    limit greatest(coalesce(p_limite, 200), 1)
  loop
    -- Token por conta, buscado quando a conta muda.
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
      -- Barrados por excesso: parar e voltar depois vale mais que insistir.
      return query select n_olh, n_mov, n_ab, n_fal; return;
    end if;

    if v_http.status <> 200 then
      n_fal := n_fal + 1;
      continue;
    end if;

    n_olh := n_olh + 1;
    v_status := (v_http.content::jsonb)->>'status';
    v_sub := (v_http.content::jsonb)->>'substatus';

    -- A tela para de mentir mesmo para quem continua aberto.
    update public.envios
       set situacao_canal = coalesce(v_status, situacao_canal),
           substatus_canal = v_sub,
           atualizado_em = now()
     where id = v_r.envio_id;

    if v_status in ('delivered','shipped') then
      update public.pacotes set etapa = 'enviado' where id = v_r.pacote_id;

      insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
      values (v_r.pacote_id, 'reconciliacao', v_r.etapa, 'enviado',
              'O Mercado Livre diz "' || v_status || '": esta caixa saiu do '
              || 'galpao pela Lexos, fora do ZYNTRA. Movido para Enviado para '
              || 'a esteira parar de mostrar pedido que ja foi entregue.');

      n_mov := n_mov + 1;
    else
      n_ab := n_ab + 1;
    end if;
  end loop;

  return query select n_olh, n_mov, n_ab, n_fal;
end;
$function$;

comment on function public.reconciliar_envios_ml is
  'Pergunta ao ML o estado real de cada pacote ainda aberto e reconcilia. So '
  'move para Enviado o que o ML disser delivered/shipped; o resto so tem o '
  'situacao_canal corrigido.';

revoke all on function public.reconciliar_envios_ml(integer) from public, anon, authenticated;
