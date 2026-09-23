-- Corrige `registrar_leitura`, que não rodava.
--
-- O parâmetro de saída chamava `sku_id`, igual à coluna `sku_id` das tabelas
-- consultadas dentro da função. O PL/pgSQL não sabe se `sku_id` no WHERE é a
-- variável ou a coluna, e recusa a consulta inteira:
--
--   column reference "sku_id" is ambiguous
--
-- A função não rodava nem uma vez. Só apareceu porque o teste bipou de
-- verdade — ler o código não pega isso.
--
-- Correção: o parâmetro de saída passa a se chamar `sku`, e toda referência a
-- coluna fica qualificada por alias.

drop function if exists public.registrar_leitura(uuid, text, text, uuid);

create or replace function public.registrar_leitura(
  p_conferencia_id uuid,
  p_codigo text,
  p_chave_cliente text,
  p_operador_id uuid default null
)
returns table (
  resultado text,
  sku uuid,
  descricao text,
  lidas integer,
  esperadas integer,
  faltam integer,
  repetida boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sku uuid;
  v_lida integer := 0;
  v_esperada integer := 0;
  v_res text;
  v_ant_resultado text;
  v_ant_sku uuid;
begin
  if not exists (
    select 1 from public.conferencias c
    where c.id = p_conferencia_id and c.situacao = 'em_andamento'
  ) then
    raise exception 'Conferencia nao esta aberta.' using errcode = 'check_violation';
  end if;

  -- Reenvio da mesma leitura: devolve a resposta anterior sem contar de novo.
  select l.resultado, l.sku_id into v_ant_resultado, v_ant_sku
  from public.leituras l
  where l.conferencia_id = p_conferencia_id
    and l.chave_cliente = p_chave_cliente;

  if found then
    select ci.quantidade_lida, ci.quantidade_esperada into v_lida, v_esperada
    from public.conferencia_itens ci
    where ci.conferencia_id = p_conferencia_id and ci.sku_id = v_ant_sku;

    return query
    select v_ant_resultado,
           v_ant_sku,
           (select s.descricao from public.skus s where s.id = v_ant_sku),
           coalesce(v_lida, 0),
           coalesce(v_esperada, 0),
           greatest(coalesce(v_esperada, 0) - coalesce(v_lida, 0), 0),
           true;
    return;
  end if;

  select cb.sku_id into v_sku
  from public.sku_codigos_barras cb
  where cb.codigo = p_codigo;

  if v_sku is null then
    v_res := 'desconhecido';
  else
    select ci.quantidade_lida, ci.quantidade_esperada into v_lida, v_esperada
    from public.conferencia_itens ci
    where ci.conferencia_id = p_conferencia_id and ci.sku_id = v_sku;

    if not found then
      v_res := 'nao_pertence';
      v_lida := 0;
      v_esperada := 0;
    elsif v_lida >= v_esperada then
      v_res := 'excedente';
    else
      v_res := 'ok';
    end if;
  end if;

  insert into public.leituras
    (conferencia_id, chave_cliente, codigo_lido, sku_id, resultado, operador_id)
  values
    (p_conferencia_id, p_chave_cliente, p_codigo, v_sku, v_res, p_operador_id);

  if v_res = 'ok' then
    update public.conferencia_itens ci
       set quantidade_lida = ci.quantidade_lida + 1
     where ci.conferencia_id = p_conferencia_id and ci.sku_id = v_sku
    returning ci.quantidade_lida, ci.quantidade_esperada into v_lida, v_esperada;
  end if;

  return query
  select v_res,
         v_sku,
         (select s.descricao from public.skus s where s.id = v_sku),
         coalesce(v_lida, 0),
         coalesce(v_esperada, 0),
         greatest(coalesce(v_esperada, 0) - coalesce(v_lida, 0), 0),
         false;
end;
$$;

comment on function public.registrar_leitura is
  'Um bipe. Mesmo codigo bipado de novo conta de novo; a MESMA leitura reenviada nao.';

revoke all on function public.registrar_leitura(uuid, text, text, uuid) from public, anon;
grant execute on function public.registrar_leitura(uuid, text, text, uuid) to authenticated;
