-- Criar e concluir lista de separação, mais as views que a tela lê.
--
-- As duas operações são atômicas de propósito. Concluir uma lista move todos
-- os pacotes dela para a conferência: se isso acontecesse pacote a pacote e
-- falhasse no meio, metade da lista ficaria conferida e metade não, sem
-- ninguém saber qual.

create or replace function public.criar_lista(p_pacote_ids uuid[])
returns table (ok boolean, motivo text, lista uuid, adicionados integer, recusados integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista uuid;
  v_add integer;
  v_pedidos integer := coalesce(array_length(p_pacote_ids, 1), 0);
begin
  if v_pedidos = 0 then
    return query select false, 'nenhum_pacote', null::uuid, 0, 0;
    return;
  end if;

  -- Só entra em lista quem está em Separar. Pacote em outra etapa ou já
  -- conferido não pode ser arrastado de volta por um clique errado.
  if exists (
    select 1 from unnest(p_pacote_ids) as x(id)
    left join public.pacotes pa on pa.id = x.id
    where pa.id is null or pa.etapa <> 'separar'
  ) then
    return query select false, 'pacote_fora_de_separar', null::uuid, 0, 0;
    return;
  end if;

  insert into public.listas_separacao (criada_por) values (auth.uid())
  returning id into v_lista;

  -- Pacote que já está numa lista ativa é recusado pelo índice parcial. Em
  -- vez de estourar, ele é pulado e contado: o operador vê quantos entraram.
  insert into public.listas_pacotes (lista_id, pacote_id)
  select v_lista, x.id from unnest(p_pacote_ids) as x(id)
  on conflict (pacote_id) where ativa do nothing;

  get diagnostics v_add = row_count;

  if v_add = 0 then
    delete from public.listas_separacao where id = v_lista;
    return query select false, 'todos_ja_em_lista', null::uuid, 0, v_pedidos;
    return;
  end if;

  return query select true, 'ok', v_lista, v_add, v_pedidos - v_add;
end;
$$;

comment on function public.criar_lista is
  'Cria a lista e prende os pacotes. Quem ja esta em lista ativa e pulado, nao estoura.';

create or replace function public.concluir_lista(p_lista_id uuid)
returns table (ok boolean, motivo text, movidos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movidos integer;
begin
  if not exists (
    select 1 from public.listas_separacao l
    where l.id = p_lista_id and l.situacao in ('aguardando', 'em_execucao')
  ) then
    return query select false, 'lista_nao_esta_aberta', 0;
    return;
  end if;

  -- Concluir a lista NÃO substitui a conferência: os pacotes vão para a
  -- bancada, um a um, e é lá que a caixa é validada.
  update public.pacotes pa
     set etapa = 'conferir'
   where pa.id in (
     select lp.pacote_id from public.listas_pacotes lp
      where lp.lista_id = p_lista_id and lp.ativa
   )
     and pa.etapa = 'separar';

  get diagnostics v_movidos = row_count;

  -- O gatilho em listas_separacao solta os pacotes ao mudar a situação.
  update public.listas_separacao l
     set situacao = 'concluida', concluida_em = now()
   where l.id = p_lista_id;

  return query select true, 'ok', v_movidos;
end;
$$;

comment on function public.concluir_lista is
  'Manda a lista inteira para a bancada de uma vez. Concluir a lista nao substitui a conferencia.';

-- --------------------------------------------------------------- views

create or replace view public.listas_resumo
with (security_invoker = true)
as
select
  l.id,
  l.codigo,
  l.situacao,
  l.criada_em,
  l.iniciada_em,
  l.concluida_em,
  o.nome as separador,
  count(lp.pacote_id) filter (where lp.ativa)::integer as pacotes,
  coalesce(sum(pa.unidades_esperadas) filter (where lp.ativa), 0)::integer as unidades,
  count(distinct pa.conta_id) filter (where lp.ativa)::integer as contas
from public.listas_separacao l
left join public.operadores o on o.id = l.separador_id
left join public.listas_pacotes lp on lp.lista_id = l.id
left join public.pacotes pa on pa.id = lp.pacote_id
group by l.id, l.codigo, l.situacao, l.criada_em, l.iniciada_em,
         l.concluida_em, o.nome;

comment on view public.listas_resumo is
  'As listas com pacotes, unidades e contas ja contados.';

-- A lista consolidada por SKU: um produto que aparece em seis pacotes vira
-- uma linha com seis unidades. É o que o separador leva no corredor.
create or replace view public.listas_itens
with (security_invoker = true)
as
select
  lp.lista_id,
  e.sku_id,
  s.codigo,
  s.descricao,
  s.foto_url,
  cb.codigo as codigo_barras,
  sum(e.quantidade)::integer as unidades,
  count(distinct pa.id)::integer as pacotes
from public.listas_pacotes lp
join public.pacotes pa on pa.id = lp.pacote_id
join public.pedidos p on p.envio_id = pa.envio_id
join public.pedido_itens i on i.pedido_id = p.id
join public.mapeamentos_anuncio m
  on m.conta_id = p.conta_id
 and m.ref_anuncio = i.ref_anuncio
 and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
cross join lateral public.explodir_sku(m.sku_id, i.quantidade) e
join public.skus s on s.id = e.sku_id
left join lateral (
  select c.codigo from public.sku_codigos_barras c
  where c.sku_id = e.sku_id and c.principal
  limit 1
) cb on true
where lp.ativa
group by lp.lista_id, e.sku_id, s.codigo, s.descricao, s.foto_url, cb.codigo;

comment on view public.listas_itens is
  'A lista do corredor, consolidada por SKU e com o kit ja explodido.';

revoke all on function public.criar_lista(uuid[]) from public, anon;
revoke all on function public.concluir_lista(uuid) from public, anon;
grant execute on function public.criar_lista(uuid[]) to authenticated;
grant execute on function public.concluir_lista(uuid) to authenticated;
