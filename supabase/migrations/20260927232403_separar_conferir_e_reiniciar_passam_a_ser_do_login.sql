-- As quatro funções da bancada param de perguntar "qual operador de PIN?" e
-- passam a usar quem está logado. O parâmetro some em vez de virar um
-- parâmetro ignorado — parâmetro que existe e não é lido é uma mentira que
-- alguém vai acreditar.

drop function if exists public.criar_lista(uuid[], uuid);

create function public.criar_lista(p_pacote_ids uuid[])
returns table(ok boolean, motivo text, lista uuid, adicionados integer, recusados integer)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_lista uuid;
  v_add integer;
  v_pedidos integer := coalesce(array_length(p_pacote_ids, 1), 0);
begin
  perform public.exige_perfil_ativo();
  if not public.pode('gerar_lista') then
    return query select false, 'sem_permissao', null::uuid, 0, 0; return;
  end if;
  if v_pedidos = 0 then
    return query select false, 'nenhum_pacote', null::uuid, 0, 0;
    return;
  end if;

  perform 1 from public.pacotes where id = any(p_pacote_ids) for update;

  if exists (
    select 1 from unnest(p_pacote_ids) as x(id)
    left join public.pacotes pa on pa.id = x.id
    where pa.id is null or pa.etapa <> 'separar'
  ) then
    return query select false, 'pacote_fora_de_separar', null::uuid, 0, 0;
    return;
  end if;

  -- Quem gerou a lista e quem separou são a mesma pessoa: quem está logado.
  insert into public.listas_separacao (criada_por, separador_id, situacao)
  values (auth.uid(), auth.uid(), 'emitida')
  returning id into v_lista;

  insert into public.listas_pacotes (lista_id, pacote_id)
  select v_lista, x.id from unnest(p_pacote_ids) as x(id)
  on conflict (pacote_id) where ativa do nothing;

  get diagnostics v_add = row_count;

  if v_add = 0 then
    delete from public.listas_separacao where id = v_lista;
    return query select false, 'todos_ja_em_lista', null::uuid, 0, v_pedidos;
    return;
  end if;

  update public.pacotes pa
     set etapa = 'conferir'
   where pa.id in (
     select lp.pacote_id from public.listas_pacotes lp where lp.lista_id = v_lista
   );

  -- Solta o cadeado: a lista saiu, os pacotes andaram, e o próximo lote pode
  -- reusar estes pacotes se precisar.
  update public.listas_pacotes set ativa = false where lista_id = v_lista;

  return query select true, 'ok', v_lista, v_add, v_pedidos - v_add;
end;
$fn$;

revoke all on function public.criar_lista(uuid[]) from public;
grant execute on function public.criar_lista(uuid[]) to authenticated;

drop function if exists public.concluir_conferencia(uuid, uuid);

create function public.concluir_conferencia(p_conferencia_id uuid)
returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_pacote uuid;
  v_faltando integer;
  v_abertas integer;
  v_liberadas integer;
begin
  perform public.exige_perfil_ativo();
  select pacote_id into v_pacote
  from public.conferencias
  where id = p_conferencia_id and situacao = 'em_andamento';

  if not found then
    return query select false, 'conferencia_nao_aberta';
    return;
  end if;

  select count(*) into v_abertas
  from public.divergencias
  where conferencia_id = p_conferencia_id and liberada_em is null;

  if v_abertas > 0 then
    return query select false, 'divergencia_aberta';
    return;
  end if;

  select count(*) into v_faltando
  from public.conferencia_itens
  where conferencia_id = p_conferencia_id
    and quantidade_lida < quantidade_esperada;

  if v_faltando > 0 then
    select count(*) into v_liberadas
    from public.divergencias
    where conferencia_id = p_conferencia_id and liberada_em is not null;

    if v_liberadas = 0 then
      return query select false, 'faltam_unidades';
      return;
    end if;
  end if;

  update public.conferencias
     set situacao = 'concluida',
         concluida_em = now(),
         concluida_por = auth.uid()
   where id = p_conferencia_id;

  update public.pacotes set etapa = 'pronto' where id = v_pacote;

  return query select true, 'ok';
end;
$fn$;

revoke all on function public.concluir_conferencia(uuid) from public;
grant execute on function public.concluir_conferencia(uuid) to authenticated;

drop function if exists public.reiniciar_conferencia(uuid, uuid);

create function public.reiniciar_conferencia(p_conferencia_id uuid)
returns table(ok boolean, motivo text, apagadas integer)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_pacote uuid;
  v_n integer := 0;
  v_quem text;
begin
  perform public.exige_perfil_ativo();

  if not public.pode('reiniciar_conferencia') then
    return query select false, 'sem_permissao', 0; return;
  end if;

  select p.nome into v_quem from public.perfis p where p.id = auth.uid();

  select c.pacote_id into v_pacote
  from public.conferencias c
  where c.id = p_conferencia_id and c.situacao = 'em_andamento';

  if v_pacote is null then
    return query select false, 'conferencia_nao_aberta', 0; return;
  end if;

  delete from public.leituras l where l.conferencia_id = p_conferencia_id;
  get diagnostics v_n = row_count;

  update public.conferencia_itens ci
     set quantidade_lida = 0
   where ci.conferencia_id = p_conferencia_id;

  delete from public.divergencias d
   where d.conferencia_id = p_conferencia_id and d.liberada_em is null;

  insert into public.eventos_pacote (pacote_id, tipo, detalhe)
  values (v_pacote, 'conferencia_reiniciada',
          'por ' || coalesce(v_quem, 'alguem') || ' · ' || v_n || ' leitura(s) apagada(s)');

  return query select true, 'ok', v_n;
end;
$fn$;

revoke all on function public.reiniciar_conferencia(uuid) from public;
grant execute on function public.reiniciar_conferencia(uuid) to authenticated;
