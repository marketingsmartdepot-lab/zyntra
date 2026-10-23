-- O leitor que faltava desde 26/09.
--
-- A fila nasceu naquela noite às 21:44 como provisória — "guardado CRU agora
-- para ser processado depois, porque a entrada de pedidos ainda não existe".
-- Duas horas depois, 23:32, a entrada de pedidos nasceu POR VARREDURA, e a
-- fila ficou órfã no mesmo dia. O "depois" nunca teve dono.
--
-- Durou um mês porque a falha é invisível: pedido novo entrava (a varredura
-- pega os de 2 horas), a tela ficava cheia, e o webhook respondia 200 ao ML.
-- Só parava o acompanhamento DEPOIS das duas primeiras horas — e isso não
-- aparece em tela nenhuma, só comparando com a realidade.
--
-- DUPLICATAS: o ML manda o mesmo aviso várias vezes em segundos (vi o mesmo
-- envio três vezes em seis segundos). Por isso o processamento é por RECURSO
-- distinto, não por linha: uma chamada ao ML por envio, e todas as linhas
-- daquele recurso saem da fila juntas.
--
-- TÓPICOS: só `shipments` e `orders_v2` mexem em algo aqui. Os outros — item,
-- preço, oferta, concorrência — são 85% do volume e o ZYNTRA não usa nenhum.
-- São marcados como processados sem gastar chamada.

create index if not exists avisos_ml_recebido on privado.avisos_ml (recebido_em);

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
  v_id text;
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
      -- Aviso de conta que nao e nossa: nao ha o que fazer com ele.
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

      -- Saiu do galpao de verdade: a esteira acompanha.
      if v_status in ('delivered','shipped')
         and v_envio.pacote_id is not null
         and v_envio.etapa in ('aberto','faturado','separar','conferir','pronto') then

        update public.pacotes set etapa = 'enviado' where id = v_envio.pacote_id;

        insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
        values (v_envio.pacote_id, 'aviso_do_ml', v_envio.etapa, 'enviado',
                'O Mercado Livre avisou que este envio esta "' || v_status || '".');
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

      -- `situacao_canal` virando 'cancelled' e o que dispara o estorno da
      -- baixa de estoque. Era a varredura de 2 horas que decidia isso, e ela
      -- nao ve pedido antigo.
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

  -- A fila ja ocupa 29% do banco. O que foi processado ha mais de uma semana
  -- nao serve mais para nada.
  delete from privado.avisos_ml
   where processado_em is not null and recebido_em < now() - interval '7 days';

  return query select n_rec, n_env, n_ped, n_desc;
end;
$function$;

comment on function privado.processar_avisos_ml is
  'Le a fila de avisos do ML. Agrupa por recurso (o ML repete o mesmo aviso), '
  'atualiza envio e pedido, e descarta os topicos que o ZYNTRA nao usa.';

create or replace function public.varrer_avisos_ml(p_limite integer default 30)
returns table (recursos integer, envios integer, pedidos integer, descartados integer)
language sql
security definer
set search_path to ''
as $$
  select * from privado.processar_avisos_ml(p_limite);
$$;

revoke all on function public.varrer_avisos_ml(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O acumulado de um mes sai da fila sem processar: `reconciliar_envios_ml`
-- acabou de perguntar ao ML o estado real de TODOS os pacotes abertos, entao
-- esses 30 mil avisos sao historia ja resolvida. Processa-los seria gastar
-- 3.600 chamadas ao ML para chegar onde ja estamos.
update privado.avisos_ml
   set processado_em = now()
 where processado_em is null;

select cron.schedule('zyntra-avisos-ml', '* * * * *',
                     $$ select public.varrer_avisos_ml(30) $$);
