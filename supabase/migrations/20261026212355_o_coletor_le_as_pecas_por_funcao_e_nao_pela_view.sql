-- A LS-0033 abriu VAZIA no celular. Eu tinha aberto `separacao_itens` e
-- `listas_pacotes` para a conta do aparelho e achei que bastava. Nao bastava:
-- a tela le `separacao_progresso`, e essa view atravessa meia dezena de
-- tabelas para montar o esperado —
--
--   listas_pacotes -> pacotes -> pedidos -> pedido_itens
--                  -> mapeamentos_anuncio -> skus -> sku_codigos_barras
--
-- todas fechadas para o aparelho por `e_da_equipe()`. Ele via a lista e zero
-- pecas.
--
-- A saida ERRADA seria abrir as sete com politicas. `pedidos` tem o nome do
-- comprador; `pacotes` tem a esteira inteira. Dar leitura disso a um celular
-- de corredor, para ele desenhar uma lista de cinco linhas, e pagar caro
-- demais por pouco — e e exatamente o furo que eu fechei hoje de manha.
--
-- A saida certa e a mesma que ja usei para os nomes dos operadores: uma
-- funcao `security definer` que devolve SO as colunas da tela, para a lista
-- que o aparelho pode separar.

create or replace function public.pecas_da_separacao(p_lista_id uuid)
returns table (
  sku_id uuid,
  codigo text,
  descricao text,
  foto_url text,
  codigo_barras text,
  esperado integer,
  separado integer,
  faltam integer,
  completo boolean,
  pacotes integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  -- A guarda fica AQUI dentro, e nao na politica: a funcao passa por cima da
  -- RLS, entao ela mesma precisa dizer quem pode e o que pode.
  if not (public.pode('separar_no_coletor') or public.e_da_equipe()) then
    return;
  end if;

  if not exists (
    select 1 from public.listas_separacao ls
    where ls.id = p_lista_id and ls.situacao = 'em_separacao'
  ) then
    return;
  end if;

  return query
  select sp.sku_id, sp.codigo, sp.descricao, sp.foto_url, sp.codigo_barras,
         sp.esperado, sp.separado, sp.faltam, sp.completo, sp.pacotes
  from public.separacao_progresso sp
  where sp.lista_id = p_lista_id
  order by sp.codigo;
end;
$function$;

comment on function public.pecas_da_separacao is
  'As pecas de uma lista em separacao, so as colunas que a tela desenha.';

revoke all on function public.pecas_da_separacao(uuid) from public, anon;
grant execute on function public.pecas_da_separacao(uuid) to authenticated;

create or replace function public.lista_da_separacao(p_lista_id uuid)
returns table (id uuid, codigo text, situacao text, modo text, separador text)
language sql
stable
security definer
set search_path to ''
as $function$
  select ls.id, ls.codigo, ls.situacao, ls.modo,
         (select o.nome from public.operadores o where o.id = ls.separador_id)
  from public.listas_separacao ls
  where ls.id = p_lista_id
    and (public.pode('separar_no_coletor') or public.e_da_equipe());
$function$;

comment on function public.lista_da_separacao is
  'O cabecalho da lista para a tela do coletor, com o nome de quem separou — '
  'que sai de `operadores`, para onde a chave estrangeira aponta.';

revoke all on function public.lista_da_separacao(uuid) from public, anon;
grant execute on function public.lista_da_separacao(uuid) to authenticated;
