-- O código do anúncio e o do catálogo costumam ser o mesmo texto. Casar antes
-- do diagnóstico evita bloquear a bancada por um problema que não existe — e
-- bloqueio falso ensina o time a ignorar o aviso, que é o pior resultado.

/**
 * Traz os pedidos pagos de uma conta do Mercado Livre.
 *
 * Em BLOCOS, como a sincronia do catálogo: o tempo de consulta do usuário
 * autenticado é de 8 segundos, e cada pedido custa uma ida extra ao ML para
 * saber a modalidade do envio. Dez por vez cabe; cinquenta não. A função
 * devolve onde parou e a tela continua dali.
 *
 * Duas coisas do ML que moldam o desenho:
 *
 *   1. Um PACK de carrinho é uma etiqueta só. Vários pedidos compartilham o
 *      mesmo `shipping.id`, e é o envio — não o pedido — que vira a caixa que
 *      o galpão separa. Por isso o pacote é único por envio.
 *   2. A modalidade só existe no envio, não no pedido. É ela que diz se aquilo
 *      entra na esteira: Full não entra, e isso foi decisão dela.
 *
 * O pacote nasce em `aberto`. Quem o move para `faturado` é `reavaliar_pacote`,
 * quando houver nota autorizada — e a nota vem do Faturador do ML.
 */
create or replace function public.sincronizar_pedidos_ml(
  p_conta_id uuid,
  p_desde timestamptz default (now() - interval '1 day'),
  p_offset integer default 0,
  p_quantos integer default 10
) returns table(
  ok boolean, motivo text, detalhe text,
  proximo_offset integer, tem_mais boolean,
  total_no_ml integer, pedidos integer, itens integer,
  envios integer, pacotes integer, fora_da_esteira integer
) language plpgsql
security definer
set search_path to ''
as $$
declare
  v_conta record;
  v_token text;
  v_motivo text;
  v_r extensions.http_response;
  v_json jsonb;
  v_lista jsonb;
  v_o jsonb;
  v_quantos integer := greatest(least(coalesce(p_quantos, 10), 25), 1);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer := 0;
  t_ped integer := 0; t_item integer := 0; t_env integer := 0;
  t_pac integer := 0; t_fora integer := 0;
  v_pedido_id uuid;
  v_envio_id uuid;
  v_envio_ref text;
  v_modalidade record;
  v_lido record;
  v_s jsonb;
  v_unidades integer;
  v_pacote_id uuid;
  v_pacotes uuid[] := '{}';
begin
  if not public.e_admin() then
    return query select false, 'so_admin', null::text, v_off, false, 0,0,0,0,0,0; return;
  end if;

  select * into v_conta from public.contas c where c.id = p_conta_id;
  if not found then
    return query select false, 'conta_nao_encontrada', null::text, v_off, false, 0,0,0,0,0,0; return;
  end if;
  if coalesce(v_conta.ref_externa, '') = '' then
    return query select false, 'conta_sem_user_id', null::text, v_off, false, 0,0,0,0,0,0; return;
  end if;

  select t.token, t.motivo into v_token, v_motivo from privado.token_ml(p_conta_id) t;
  if coalesce(v_token, '') = '' then
    return query select false, coalesce(v_motivo, 'sem_conexao'), null::text, v_off, false, 0,0,0,0,0,0;
    return;
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '4000');

  begin
    select * into v_r from extensions.http((
      'GET',
      'https://api.mercadolibre.com/orders/search'
        || '?seller=' || extensions.urlencode(v_conta.ref_externa)
        || '&order.status=paid'
        || '&order.date_created.from=' || extensions.urlencode(
             to_char(p_desde at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'))
        || '&sort=date_asc'
        || '&offset=' || v_off
        || '&limit=' || v_quantos,
      array[
        extensions.http_header('Accept', 'application/json'),
        extensions.http_header('Authorization', 'Bearer ' || v_token)
      ],
      null, null
    )::extensions.http_request);
  exception when others then
    return query select false, 'rede', sqlerrm, v_off, true, 0,0,0,0,0,0; return;
  end;

  if v_r.status <> 200 then
    return query select false,
      case when v_r.status = 401 then 'conexao_recusada'
           when v_r.status = 403 then 'sem_permissao_no_ml'
           when v_r.status = 429 then 'ml_pediu_calma'
           else 'recusado' end,
      'O Mercado Livre respondeu ' || v_r.status || ': ' || left(coalesce(v_r.content,''), 300),
      v_off, true, 0,0,0,0,0,0;
    return;
  end if;

  v_json := v_r.content::jsonb;
  v_lista := coalesce(v_json->'results', '[]'::jsonb);
  v_total := coalesce((v_json#>>'{paging,total}')::integer, 0);

  for v_o in select * from jsonb_array_elements(v_lista) loop
    v_envio_id := null;
    v_modalidade := null;
    v_envio_ref := v_o#>>'{shipping,id}';

    if coalesce(v_envio_ref, '') <> '' then
      begin
        perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '3000');
        select * into v_r from extensions.http((
          'GET',
          'https://api.mercadolibre.com/shipments/' || v_envio_ref,
          array[
            extensions.http_header('Accept', 'application/json'),
            extensions.http_header('Authorization', 'Bearer ' || v_token)
          ],
          null, null
        )::extensions.http_request);
        v_s := case when v_r.status between 200 and 299
                    then v_r.content::jsonb else '{}'::jsonb end;
      exception when others then
        v_s := '{}'::jsonb;
      end;

      select * into v_lido from privado.envio_do_ml(v_s);

      select m.* into v_modalidade
      from public.modalidades m
      join public.canais ca on ca.id = m.canal_id
      where ca.slug = 'mercado_livre' and m.slug = coalesce(v_lido.modalidade, '');

      insert into public.envios as e
        (conta_id, modalidade_id, ref_externa, situacao_canal, substatus_canal,
         limite_envio_em, limite_origem, volumes, bruto, sincronizado_em)
      values (
        p_conta_id, v_modalidade.id, v_envio_ref,
        v_s->>'status', v_s->>'substatus',
        v_lido.prazo, v_lido.origem,
        coalesce(nullif(v_s->>'quantity','')::integer, 1),
        v_s, now())
      on conflict (conta_id, ref_externa) do update
        set modalidade_id = coalesce(excluded.modalidade_id, e.modalidade_id),
            situacao_canal = excluded.situacao_canal,
            substatus_canal = excluded.substatus_canal,
            limite_envio_em = coalesce(excluded.limite_envio_em, e.limite_envio_em),
            limite_origem = coalesce(excluded.limite_origem, e.limite_origem),
            volumes = excluded.volumes,
            bruto = excluded.bruto,
            sincronizado_em = now(),
            atualizado_em = now()
      returning e.id into v_envio_id;

      t_env := t_env + 1;
      if coalesce(v_modalidade.entra_na_esteira, false) = false then
        t_fora := t_fora + 1;
      end if;
    end if;

    insert into public.pedidos as p
      (conta_id, envio_id, ref_externa, pack_ref, situacao_canal, comprador,
       pago_em, criado_no_canal_em, atualizado_no_canal_em, total, unidades,
       bruto, sincronizado_em)
    values (
      p_conta_id, v_envio_id, v_o->>'id', v_o->>'pack_id',
      v_o->>'status', v_o#>>'{buyer,nickname}',
      nullif(v_o->>'date_closed','')::timestamptz,
      nullif(v_o->>'date_created','')::timestamptz,
      nullif(v_o->>'last_updated','')::timestamptz,
      nullif(v_o->>'total_amount','')::numeric,
      (select coalesce(sum((i->>'quantity')::integer), 0)
         from jsonb_array_elements(coalesce(v_o->'order_items','[]'::jsonb)) i),
      v_o, now())
    on conflict (conta_id, ref_externa) do update
      set envio_id = coalesce(excluded.envio_id, p.envio_id),
          pack_ref = excluded.pack_ref,
          situacao_canal = excluded.situacao_canal,
          comprador = excluded.comprador,
          pago_em = coalesce(excluded.pago_em, p.pago_em),
          atualizado_no_canal_em = excluded.atualizado_no_canal_em,
          total = excluded.total,
          unidades = excluded.unidades,
          bruto = excluded.bruto,
          sincronizado_em = now(),
          atualizado_em = now()
    returning p.id into v_pedido_id;

    t_ped := t_ped + 1;

    -- Sem chave natural, então reescreve: reimportar não pode deixar item
    -- fantasma de uma versão anterior do pedido.
    delete from public.pedido_itens pi where pi.pedido_id = v_pedido_id;

    insert into public.pedido_itens
      (pedido_id, ref_anuncio, ref_variacao, sku_informado, titulo, foto_url,
       quantidade, preco_unitario)
    select
      v_pedido_id,
      i#>>'{item,id}',
      nullif(i#>>'{item,variation_id}',''),
      coalesce(nullif(i#>>'{item,seller_sku}',''), nullif(i#>>'{item,seller_custom_field}','')),
      i#>>'{item,title}',
      null,
      coalesce((i->>'quantity')::integer, 1),
      nullif(i->>'unit_price','')::numeric
    from jsonb_array_elements(coalesce(v_o->'order_items','[]'::jsonb)) i;

    get diagnostics v_unidades = row_count;
    t_item := t_item + v_unidades;

    if v_envio_id is not null and coalesce(v_modalidade.entra_na_esteira, false) then
      insert into public.pacotes as pa (envio_id, conta_id, etapa, unidades_esperadas)
      values (v_envio_id, p_conta_id, 'aberto',
              (select coalesce(sum(pi.quantidade), 0)
                 from public.pedido_itens pi
                 join public.pedidos pd on pd.id = pi.pedido_id
                where pd.envio_id = v_envio_id))
      on conflict (envio_id) do update
        set unidades_esperadas = excluded.unidades_esperadas,
            atualizado_em = now()
      returning pa.id into v_pacote_id;

      v_pacotes := v_pacotes || v_pacote_id;
      t_pac := t_pac + 1;
    end if;
  end loop;

  -- O código do anúncio e o do catálogo costumam ser o mesmo texto. Casar
  -- antes do diagnóstico evita bloquear a bancada por um problema que não
  -- existe — e bloqueio falso ensina o time a ignorar o aviso.
  perform public.casar_anuncios_por_codigo(p_conta_id);

  -- Por que cada caixa está parada. Sem isto o pacote existe, o contador da
  -- aba o vê, e a tela de Aberto — que mostra BLOQUEIOS agrupados por causa —
  -- não mostra nada. Parado e invisível é pior que parado.
  foreach v_pacote_id in array v_pacotes loop
    perform public.diagnosticar_pacote(v_pacote_id);
  end loop;

  return query select
    true, 'ok', null::text,
    v_off + jsonb_array_length(v_lista),
    (v_off + jsonb_array_length(v_lista)) < v_total and jsonb_array_length(v_lista) > 0,
    v_total, t_ped, t_item, t_env, t_pac, t_fora;
end;
$$;

revoke all on function public.sincronizar_pedidos_ml(uuid, timestamptz, integer, integer) from public;
grant execute on function public.sincronizar_pedidos_ml(uuid, timestamptz, integer, integer) to authenticated;
