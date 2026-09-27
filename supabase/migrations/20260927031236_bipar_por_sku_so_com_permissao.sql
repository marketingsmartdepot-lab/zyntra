-- Conferir digitando o código do SKU passa a exigir permissão do operador.
--
-- Bipar lê o que está na caixa; digitar é alguém afirmando o que está. As
-- duas fecham a conferência do mesmo jeito, mas não são a mesma prova — e
-- quem pode afirmar tem que ser escolhido, não qualquer um que esteja na
-- bancada naquela hora.
--
-- Sem turno aberto não há quem afirme, então o atalho também não vale: a
-- leitura cai em "desconhecido", como antes.
create or replace function public.registrar_leitura(
  p_conferencia_id uuid,
  p_codigo text,
  p_chave_cliente text,
  p_operador_id uuid default null
) returns table(resultado text, sku uuid, descricao text, lidas integer,
                esperadas integer, faltam integer, repetida boolean)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_sku uuid;
  v_lida integer := 0;
  v_esperada integer := 0;
  v_res text;
  v_ant_resultado text;
  v_ant_sku uuid;
  v_casou text;
  v_codigo text := btrim(coalesce(p_codigo, ''));
  v_candidatos uuid[];
  v_na_caixa uuid[];
  v_desc text;
  v_pode_sku boolean := false;
begin
  perform public.exige_perfil_ativo();
  if not exists (
    select 1 from public.conferencias c
    where c.id = p_conferencia_id and c.situacao = 'em_andamento'
  ) then
    raise exception 'Conferencia nao esta aberta.' using errcode = 'check_violation';
  end if;

  select l.resultado, l.sku_id into v_ant_resultado, v_ant_sku
  from public.leituras l
  where l.conferencia_id = p_conferencia_id
    and l.chave_cliente = p_chave_cliente;

  if found then
    select ci.quantidade_lida, ci.quantidade_esperada into v_lida, v_esperada
    from public.conferencia_itens ci
    where ci.conferencia_id = p_conferencia_id and ci.sku_id = v_ant_sku;

    return query
    select v_ant_resultado, v_ant_sku,
           (select s.descricao from public.skus s where s.id = v_ant_sku),
           coalesce(v_lida, 0), coalesce(v_esperada, 0),
           greatest(coalesce(v_esperada, 0) - coalesce(v_lida, 0), 0),
           true;
    return;
  end if;

  select coalesce(o.pode_bipar_por_sku, false) into v_pode_sku
  from public.operadores o where o.id = p_operador_id and o.ativo;

  -- 1. código de barras: a prova forte. Pode levar a mais de um produto.
  select array_agg(distinct cb.sku_id) into v_candidatos
  from public.sku_codigos_barras cb
  where cb.codigo = v_codigo;

  if v_candidatos is not null and cardinality(v_candidatos) > 0 then
    v_casou := 'codigo_barras';
  elsif coalesce(v_pode_sku, false) then
    -- 2. código do SKU, digitado, e só por quem pode.
    select array_agg(s.id) into v_candidatos
    from public.skus s
    where upper(btrim(s.codigo)) = upper(v_codigo);

    if v_candidatos is not null and cardinality(v_candidatos) > 0 then
      v_casou := 'codigo_sku';
    end if;
  end if;

  if v_candidatos is null or cardinality(v_candidatos) = 0 then
    v_res := 'desconhecido';
  else
    select array_agg(ci.sku_id) into v_na_caixa
    from public.conferencia_itens ci
    where ci.conferencia_id = p_conferencia_id
      and ci.sku_id = any(v_candidatos);

    if v_na_caixa is null or cardinality(v_na_caixa) = 0 then
      v_res := 'nao_pertence';
      v_sku := v_candidatos[1];
      v_lida := 0;
      v_esperada := 0;
    elsif cardinality(v_na_caixa) > 1 then
      v_res := 'ambiguo';
      v_sku := null;
      v_lida := 0;
      v_esperada := 0;
    else
      v_sku := v_na_caixa[1];

      select ci.quantidade_lida, ci.quantidade_esperada into v_lida, v_esperada
      from public.conferencia_itens ci
      where ci.conferencia_id = p_conferencia_id and ci.sku_id = v_sku;

      if v_lida >= v_esperada then v_res := 'excedente'; else v_res := 'ok'; end if;
    end if;
  end if;

  insert into public.leituras
    (conferencia_id, chave_cliente, codigo_lido, sku_id, resultado, operador_id, casou_por)
  values
    (p_conferencia_id, p_chave_cliente, v_codigo, v_sku, v_res, p_operador_id, v_casou);

  if v_res = 'ok' then
    update public.conferencia_itens ci
       set quantidade_lida = ci.quantidade_lida + 1
     where ci.conferencia_id = p_conferencia_id and ci.sku_id = v_sku
    returning ci.quantidade_lida, ci.quantidade_esperada into v_lida, v_esperada;
  end if;

  if v_res = 'ambiguo' then
    v_desc := 'Este código está em mais de um produto desta caixa: '
      || (select string_agg(s.codigo, ', ' order by s.codigo)
            from public.skus s where s.id = any(v_na_caixa));
  else
    v_desc := (select s.descricao from public.skus s where s.id = v_sku);
  end if;

  return query
  select v_res, v_sku, v_desc,
         coalesce(v_lida, 0), coalesce(v_esperada, 0),
         greatest(coalesce(v_esperada, 0) - coalesce(v_lida, 0), 0),
         false;
end;
$$;
