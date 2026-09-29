-- Quem separou fica gravado no PRIMEIRO BIPE, não ao abrir a tela.
--
-- Abrir a tela é um GET, e GET não deve escrever. Além disso, abrir a lista
-- para olhar não é separar: quem carimba é quem pega a peça. E o carimbo segue
-- a última pessoa a bipar, porque trocar de gente no meio (almoço, fim de
-- turno) é rotina — guardar só a primeira faria o histórico mentir sobre a
-- segunda metade do corredor.
drop function if exists public.somar_na_separacao(uuid, uuid, text);
drop function if exists public.bipar_separacao(uuid, text);

create function public.somar_na_separacao(
  p_lista_id uuid,
  p_sku_id uuid,
  p_codigo text default null,
  p_operador_id uuid default null
) returns table(
  ok boolean, motivo text, id_do_sku uuid, codigo text, descricao text,
  separado integer, esperado integer, faltam_na_lista integer, candidatos jsonb
)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_sep integer;
  v_esp integer;
  v_cod text;
  v_desc text;
  v_faltam integer;
begin
  perform public.exige_perfil_ativo();

  if not exists (
    select 1 from public.listas_separacao ls
    where ls.id = p_lista_id and ls.situacao = 'em_separacao'
  ) then
    return query select false, 'lista_nao_esta_em_separacao',
      null::uuid, null::text, null::text, 0, 0, 0, null::jsonb;
    return;
  end if;

  select sp.separado, sp.esperado, sp.codigo, sp.descricao
    into v_sep, v_esp, v_cod, v_desc
  from public.separacao_progresso sp
  where sp.lista_id = p_lista_id and sp.sku_id = p_sku_id;

  if v_esp is null then
    return query select false, 'nao_pertence',
      p_sku_id, p_codigo, null::text, 0, 0, 0, null::jsonb;
    return;
  end if;

  -- Já completo: não soma. Somar aqui faria o coletor aceitar a quarta peça de
  -- um produto que pede três, e o erro só apareceria na bancada.
  if v_sep >= v_esp then
    select count(*)::integer into v_faltam
    from public.separacao_progresso sp
    where sp.lista_id = p_lista_id and not sp.completo;

    return query select false, 'ja_completo',
      p_sku_id, v_cod, v_desc, v_sep, v_esp, v_faltam, null::jsonb;
    return;
  end if;

  insert into public.separacao_itens as si (lista_id, sku_id, quantidade)
  values (p_lista_id, p_sku_id, 1)
  on conflict (lista_id, sku_id) do update
    set quantidade = si.quantidade + 1,
        atualizado_em = now()
  returning si.quantidade into v_sep;

  -- Quem bipou é quem separou.
  if p_operador_id is not null then
    update public.listas_separacao
       set separador_id = p_operador_id
     where id = p_lista_id
       and separador_id is distinct from p_operador_id;
  end if;

  select count(*)::integer into v_faltam
  from public.separacao_progresso sp
  where sp.lista_id = p_lista_id and not sp.completo;

  return query select true, 'ok', p_sku_id, v_cod, v_desc, v_sep, v_esp, v_faltam, null::jsonb;
end;
$fn$;

create function public.bipar_separacao(
  p_lista_id uuid,
  p_codigo text,
  p_operador_id uuid default null
) returns table(
  ok boolean, motivo text, id_do_sku uuid, codigo text, descricao text,
  separado integer, esperado integer, faltam_na_lista integer, candidatos jsonb
)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_codigo text := btrim(coalesce(p_codigo, ''));
  v_cands uuid[];
  v_na_lista uuid[];
  v_cands_json jsonb;
begin
  perform public.exige_perfil_ativo();

  if not exists (
    select 1 from public.listas_separacao ls
    where ls.id = p_lista_id and ls.situacao = 'em_separacao'
  ) then
    return query select false, 'lista_nao_esta_em_separacao',
      null::uuid, null::text, null::text, 0, 0, 0, null::jsonb;
    return;
  end if;

  if v_codigo = '' then
    return query select false, 'codigo_vazio',
      null::uuid, null::text, null::text, 0, 0, 0, null::jsonb;
    return;
  end if;

  select array_agg(distinct cb.sku_id) into v_cands
  from public.sku_codigos_barras cb
  where cb.codigo = v_codigo;

  if v_cands is null or cardinality(v_cands) = 0 then
    select array_agg(s.id) into v_cands
    from public.skus s
    where upper(btrim(s.codigo)) = upper(v_codigo);
  end if;

  if v_cands is null or cardinality(v_cands) = 0 then
    return query select false, 'desconhecido',
      null::uuid, v_codigo, null::text, 0, 0, 0, null::jsonb;
    return;
  end if;

  select array_agg(sp.sku_id) into v_na_lista
  from public.separacao_progresso sp
  where sp.lista_id = p_lista_id and sp.sku_id = any(v_cands);

  if v_na_lista is null or cardinality(v_na_lista) = 0 then
    return query select false, 'nao_pertence',
      v_cands[1], v_codigo,
      (select s.descricao from public.skus s where s.id = v_cands[1]),
      0, 0, 0, null::jsonb;
    return;
  end if;

  -- 85 códigos de barras do catálogo dela são compartilhados por 204 produtos.
  -- Na bancada isso se resolve porque o sistema sabe o que tem naquela caixa;
  -- aqui só a pessoa sabe qual pegou. Devolve os dois e deixa ela apontar.
  if cardinality(v_na_lista) > 1 then
    select jsonb_agg(jsonb_build_object(
             'sku_id', sp.sku_id, 'codigo', sp.codigo,
             'descricao', sp.descricao,
             'separado', sp.separado, 'esperado', sp.esperado))
      into v_cands_json
    from public.separacao_progresso sp
    where sp.lista_id = p_lista_id and sp.sku_id = any(v_na_lista);

    return query select false, 'ambiguo',
      null::uuid, v_codigo, null::text, 0, 0, 0, v_cands_json;
    return;
  end if;

  return query select * from public.somar_na_separacao(
    p_lista_id, v_na_lista[1], v_codigo, p_operador_id);
end;
$fn$;

revoke all on function public.bipar_separacao(uuid, text, uuid) from public;
revoke all on function public.somar_na_separacao(uuid, uuid, text, uuid) from public;
grant execute on function public.bipar_separacao(uuid, text, uuid) to authenticated;
grant execute on function public.somar_na_separacao(uuid, uuid, text, uuid) to authenticated;
