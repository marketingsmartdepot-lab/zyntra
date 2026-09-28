-- As quatro funções que falavam 'encerrado' passam a falar 'enviado', e a
-- esteira ganha as duas transições novas.

-- 1. A regra de transição -------------------------------------------------
create or replace function public.validar_transicao_etapa()
returns trigger
language plpgsql
set search_path to ''
as $fn$
declare
  permitido boolean := false;
begin
  if new.etapa = old.etapa then
    return new;
  end if;

  -- Reter e enviar valem de qualquer lugar: um é problema externo, o outro é a
  -- caixa fisicamente fora do galpão. Nenhum dos dois pede licença à esteira.
  if new.etapa in ('enviado', 'retido') then
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
      -- Bipar na porta.
      ('pronto',   'envio'),
      -- Bipe errado se desfaz enquanto a saída não fechou.
      ('envio',    'pronto')
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
$fn$;

-- 2. Bipar na porta move a caixa para Envio --------------------------------
create or replace function public.bipar_saida(
  p_saida_id uuid,
  p_pacote_id uuid,
  p_operador_id uuid default null
) returns table(ok boolean, motivo text, custo numeric)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_mod uuid;
  v_custo numeric;
begin
  if not exists (
    select 1 from public.saidas s
    where s.id = p_saida_id and s.situacao = 'em_andamento'
  ) then
    return query select false, 'saida_nao_aberta', null::numeric;
    return;
  end if;

  if exists (
    select 1 from public.saida_pacotes sp
    where sp.saida_id = p_saida_id and sp.pacote_id = p_pacote_id
  ) then
    return query select false, 'ja_bipado', null::numeric;
    return;
  end if;

  if not exists (
    select 1 from public.pacotes pa
    where pa.id = p_pacote_id and pa.etapa = 'pronto'
  ) then
    return query select false, 'pacote_nao_esta_pronto', null::numeric;
    return;
  end if;

  if not exists (
    select 1 from public.entregas_doca_pacotes ep
    where ep.pacote_id = p_pacote_id
  ) then
    return query select false, 'pacote_nao_entregue_na_doca', null::numeric;
    return;
  end if;

  select e.modalidade_id into v_mod
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  where pa.id = p_pacote_id;

  v_custo := public.custo_etiqueta_em(v_mod, current_date);

  insert into public.saida_pacotes (saida_id, pacote_id, operador_id, custo_etiqueta)
  values (p_saida_id, p_pacote_id, p_operador_id, v_custo);

  -- A caixa está no caminhão. Sai de Pronto pra envio e vai para Envio, onde
  -- fica enquanto a saída não fechar.
  update public.pacotes set etapa = 'envio' where id = p_pacote_id;

  return query select true, 'ok', v_custo;
end;
$fn$;

revoke all on function public.bipar_saida(uuid, uuid, uuid) from public;
grant execute on function public.bipar_saida(uuid, uuid, uuid) to authenticated;

-- 3. Fechar a saída manda para Enviado -------------------------------------
create or replace function public.fechar_saida(p_saida_id uuid)
returns table(ok boolean, motivo text, pacotes integer, total numeric)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_n integer;
  v_total numeric;
begin
  perform public.exige_perfil_ativo();
  if not exists (
    select 1 from public.saidas s
    where s.id = p_saida_id and s.situacao = 'em_andamento'
  ) then
    return query select false, 'saida_nao_aberta', 0, 0::numeric;
    return;
  end if;

  select count(*), coalesce(sum(sp.custo_etiqueta), 0)
    into v_n, v_total
  from public.saida_pacotes sp
  where sp.saida_id = p_saida_id;

  if v_n = 0 then
    return query select false, 'saida_vazia', 0, 0::numeric;
    return;
  end if;

  update public.saidas s
     set situacao = 'fechada',
         fechada_em = now(),
         minuta_gerada_em = now()
   where s.id = p_saida_id;

  update public.pacotes pa
     set etapa = 'enviado'
   where pa.id in (
     select sp.pacote_id from public.saida_pacotes sp where sp.saida_id = p_saida_id
   )
     and pa.etapa <> 'enviado';

  return query select true, 'ok', v_n, v_total;
end;
$fn$;

revoke all on function public.fechar_saida(uuid) from public;
grant execute on function public.fechar_saida(uuid) to authenticated;

-- 4. Reter falava 'encerrado' ----------------------------------------------
create or replace function public.reter_pacotes(p_ids uuid[], p_motivo text)
returns table(ok boolean, motivo text, retidos integer, recusados jsonb)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_n integer := 0;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_recusados jsonb;
  v_id uuid;
begin
  perform public.exige_perfil_ativo();
  if not public.pode('reter_pedido') then
    return query select false, 'sem_permissao', 0, null::jsonb; return;
  end if;

  if p_ids is null or array_length(p_ids,1) is null then
    return query select false, 'nada_selecionado', 0, null::jsonb; return;
  end if;

  if v_motivo = '' then
    return query select false, 'sem_motivo', 0, null::jsonb; return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'motivo', x.porque)), '[]'::jsonb)
    into v_recusados
  from (
    select e.ref_externa as codigo,
           case when pa.etapa = 'retido' then 'ja estava retido'
                when pa.etapa = 'enviado' then 'ja saiu do galpao' end as porque
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    where pa.id = any(p_ids) and pa.etapa in ('retido','enviado')
  ) x;

  for v_id in
    select pa.id from public.pacotes pa
    where pa.id = any(p_ids) and pa.etapa not in ('retido','enviado')
  loop
    update public.pacotes set etapa = 'retido' where id = v_id;

    update public.eventos_pacote
       set detalhe = v_motivo
     where id = (select max(id) from public.eventos_pacote
                  where pacote_id = v_id and tipo = 'etapa');

    v_n := v_n + 1;
  end loop;

  return query select true, 'ok', v_n, v_recusados;
end;
$fn$;
