-- "voce colocou envio, muda para enviado".
--
-- Eu tinha partido em dois: `envio` (bipada na porta, saída aberta) e
-- `enviado` (saída fechada). Com a aba chamada Enviado isso vira uma mentira
-- na tela: a caixa entraria na aba e SUMIRIA dela no instante em que ficasse,
-- de fato, enviada.
--
-- Então é um estado só. A caixa vai para `enviado` quando é bipada na porta —
-- a fronteira que ela escolheu — e fica lá. A diferença entre "carregando" e
-- "já foi" continua existindo onde ela importa: na Logística, pela saída estar
-- aberta ou fechada.
--
-- O valor `envio` fica no enum sem uso. O Postgres não deixa remover valor de
-- enum, e inventar tabela de compatibilidade para apagar uma palavra seria pior
-- que a palavra sobrando.

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

  -- Bipou na porta: a caixa saiu. Fim da esteira.
  update public.pacotes set etapa = 'enviado' where id = p_pacote_id;

  return query select true, 'ok', v_custo;
end;
$fn$;

revoke all on function public.bipar_saida(uuid, uuid, uuid) from public;
grant execute on function public.bipar_saida(uuid, uuid, uuid) to authenticated;

-- Fechar a saída não mexe mais em etapa: as caixas já foram no bipe. Ele volta
-- a ser só o ato de gerar a minuta e congelar o total.
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

  return query select true, 'ok', v_n, v_total;
end;
$fn$;

revoke all on function public.fechar_saida(uuid) from public;
grant execute on function public.fechar_saida(uuid) to authenticated;

-- Desfazer um bipe errado continua valendo enquanto a saída não fechou.
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
      -- Bipe errado na porta se desfaz enquanto a saída não fechou.
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
$fn$;
