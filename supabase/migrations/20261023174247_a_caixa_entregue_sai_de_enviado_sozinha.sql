-- Quem leva a caixa de Enviado para Entregue e o ML, pelos dois caminhos que
-- ja existem: o leitor de avisos (por minuto) e a varredura diaria.
--
-- A regra de "chegou" mora numa funcao so, pelo mesmo motivo que a de "saiu":
-- copiada em dois lugares, ela divergiu, e foi assim que as caixas ficaram
-- penduradas em Pronto hoje.

-- ----------------------------------------------- 1. o guarda das transicoes
-- `entregue` entra no mesmo grupo de `enviado` e `retido`: aceito vindo de
-- qualquer etapa. O desenho do guarda ja dizia por que — nessas tres quem
-- manda e o CANAL, nao o galpao, e a caixa pode chegar ao ZYNTRA ja num
-- estado que ele nunca viu acontecer. Caixa despachada pela Lexos que o ML da
-- como entregue nunca passou por Pronto aqui.
--
-- `entregue -> enviado` tambem passa a valer, para o caso de o ML se corrigir.
-- NAO automatizei a volta: hoje so `delivered` move a caixa, e desfazer uma
-- entrega e decisao de gente.
create or replace function public.validar_transicao_etapa()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  permitido boolean := false;
begin
  if new.etapa = old.etapa then
    return new;
  end if;

  if new.etapa in ('enviado', 'retido', 'entregue') then
    permitido := true;
  elsif old.etapa = 'retido' then
    permitido := new.etapa = old.etapa_anterior;
  else
    permitido := (old.etapa, new.etapa) in (
      ('aberto',   'faturado'),
      ('faturado', 'separar'),
      ('faturado', 'aberto'),
      ('separar',  'conferir'),
      ('separar',  'faturado'),
      ('conferir', 'pronto'),
      ('conferir', 'separar'),
      -- Bipe errado na porta se desfaz enquanto a saida nao fechou.
      ('enviado',  'pronto')
    );
  end if;

  if not permitido then
    raise exception
      'Transicao de etapa invalida: % -> % (pacote %)',
      old.etapa, new.etapa, old.id
      using errcode = 'check_violation';
  end if;

  if new.etapa = 'retido' and old.etapa <> 'retido' then
    new.etapa_anterior := old.etapa;
  elsif old.etapa = 'retido' then
    new.etapa_anterior := null;
  end if;

  new.etapa_desde := now();

  insert into public.eventos_pacote (pacote_id, tipo, de, para, por)
  values (old.id, 'etapa', old.etapa::text, new.etapa::text, auth.uid());

  return new;
end;
$function$;

-- --------------------------------------------------- 2. a regra de "chegou"
-- 'delivered' e so o que conta. `not_delivered` NAO entra: tentativa de
-- entrega frustrada nao e entrega, a caixa continua na rua e pode voltar.
create or replace function public.envio_chegou_no_cliente(
  p_status text, p_substatus text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  -- `p_substatus` entra na assinatura so para ficar igual a
  -- envio_saiu_do_galpao: quem for acrescentar caso novo acha os dois lados
  -- da decisao no mesmo formato. Hoje o status basta.
  select coalesce(p_status, '') = 'delivered';
$function$;

comment on function public.envio_chegou_no_cliente is
  'A caixa chegou no cliente? So `delivered`. Tentativa frustrada de entrega '
  'nao conta: a caixa continua na rua e pode voltar.';

-- ------------------------------------------------- 3. a varredura diaria
-- Passa a olhar tambem quem esta em `enviado`, que antes ela nem lia: a
-- esteira terminava ali e nao havia para onde mover.
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
    where pa.etapa in ('aberto','faturado','separar','conferir','pronto','enviado')
      and coalesce(e.ref_externa,'') <> ''
    -- Quem ainda esta no galpao vem primeiro: e a fila que mente mais caro.
    order by (pa.etapa = 'enviado'), pa.etapa_desde
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

    -- Chegou no cliente: fim da linha, e vale tanto para quem estava em
    -- Enviado quanto para quem o ZYNTRA nunca viu sair.
    if public.envio_chegou_no_cliente(v_status, v_sub) then
      update public.pacotes set etapa = 'entregue' where id = v_r.pacote_id;

      insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
      values (v_r.pacote_id, 'reconciliacao', v_r.etapa, 'entregue',
              'O Mercado Livre diz que esta caixa foi entregue.');

      n_mov := n_mov + 1;

    elsif public.envio_saiu_do_galpao(v_status, v_sub) then
      -- Quem ja esta em Enviado so fica onde esta: a mudanca de substatus
      -- dentro de Enviado e informacao de tela, nao movimento de esteira.
      if v_r.etapa <> 'enviado' then
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
    else
      n_ab := n_ab + 1;
    end if;
  end loop;

  return query select n_olh, n_mov, n_ab, n_fal;
end;
$function$;

comment on function public.reconciliar_envios_ml is
  'Pergunta ao ML o estado real de cada pacote que nao chegou ainda — '
  'inclusive os que estao em Enviado, para levar a Entregue o que chegou. '
  'Quem decide e envio_saiu_do_galpao / envio_chegou_no_cliente.';

-- ----------------------------------------- 4. o leitor de avisos por minuto
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

      -- A esteira acompanha. As regras sao as MESMAS da varredura diaria:
      -- elas moravam copiadas aqui e as duas copias divergiram.
      if v_envio.pacote_id is not null then
        if public.envio_chegou_no_cliente(v_status, v_sub)
           and v_envio.etapa <> 'entregue' then

          update public.pacotes set etapa = 'entregue' where id = v_envio.pacote_id;

          insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
          values (v_envio.pacote_id, 'aviso_do_ml', v_envio.etapa, 'entregue',
                  'O Mercado Livre avisou que esta caixa foi entregue.');

        elsif public.envio_saiu_do_galpao(v_status, v_sub)
              and v_envio.etapa in ('aberto','faturado','separar','conferir','pronto') then

          update public.pacotes set etapa = 'enviado' where id = v_envio.pacote_id;

          insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
          values (v_envio.pacote_id, 'aviso_do_ml', v_envio.etapa, 'enviado',
                  'O Mercado Livre avisou "' || coalesce(v_status,'?')
                  || coalesce(' / ' || v_sub, '') || '": esta caixa saiu do galpao.');
        end if;
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

-- ---------------------------------------------------------------------------
-- 5. As 138 que o ML ja marcou como entregues mudam de aba agora. Sem isto, a
-- aba Entregue nasceria vazia com o mesmo balaio de 156 do lado.
--
-- Uma por uma, e nao num UPDATE de conjunto: o gatilho `validar_transicao_etapa`
-- grava um evento por linha e precisa ver cada transicao.
do $$
declare v_r record; v_n integer := 0;
begin
  for v_r in
    select pa.id
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    where pa.etapa = 'enviado'
      and e.situacao_canal = 'delivered'
  loop
    update public.pacotes set etapa = 'entregue' where id = v_r.id;

    insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
    values (v_r.id, 'reconciliacao', 'enviado', 'entregue',
            'O Mercado Livre ja dava esta caixa como entregue quando a etapa '
            || 'Entregue passou a existir.');

    v_n := v_n + 1;
  end loop;

  raise notice 'movidas para Entregue: %', v_n;
end $$;
