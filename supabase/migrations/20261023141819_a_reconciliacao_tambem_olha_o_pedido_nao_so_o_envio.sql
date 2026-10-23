-- `reconciliar_envios_ml` atualizava o ENVIO e esquecia o PEDIDO. Os dois têm
-- status próprio no ML e eles divergem: achei três pacotes com o envio
-- `cancelled` e o pedido ainda `paid` aqui — o pedido estava cancelado no ML
-- desde setembro, congelado pela mesma janela de 2 horas.
--
-- Isso importa além da tela: é `pedidos.situacao_canal` virando `cancelled`
-- que dispara DUAS coisas — o estorno da baixa de estoque e a saída da
-- esteira para Retidos. Com o pedido congelado em `paid`, nenhuma das duas
-- acontece.
--
-- Não vou buscar o pedido de TODO pacote: dobraria as chamadas ao ML por
-- nada, já que na esmagadora maioria o pedido segue pago e o envio conta a
-- história toda. Busco quando o envio está `cancelled`, que é o caso em que
-- envio e pedido podem discordar e a discordância custa caro.

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
  'Pergunta ao ML o estado real de cada pacote aberto. Move para Enviado o que '
  'estiver delivered/shipped, e quando o envio estiver cancelado pergunta '
  'tambem pelo pedido — e o status do pedido que dispara Retidos e o estorno.';
