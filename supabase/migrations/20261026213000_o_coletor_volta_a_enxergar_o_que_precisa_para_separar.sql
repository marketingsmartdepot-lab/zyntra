-- FECHEI DEMAIS. A Daniele entrou por PIN, abriu a separacao, e a tela disse
-- que ninguem tem PIN cadastrado — logo depois de ela ter entrado com um.
--
-- Causa: tirar a conta do aparelho de `e_da_equipe()` fechou TUDO que depende
-- dessa funcao, e tres coisas que a separacao precisa dependiam:
--
--   operadores        para reconhecer quem esta com o aparelho
--   separacao_itens   as pecas a pegar
--   listas_pacotes    as caixas da lista
--
-- O remedio nao e devolver `e_da_equipe()` para o aparelho — isso reabriria o
-- banco inteiro. E abrir, uma a uma, so o que a separacao usa.
--
-- E EM `operadores` NAO ABRO NADA. Aquela tabela guarda `pin_hash`, e
-- politica de RLS e por LINHA, nao por coluna: liberar a leitura entregaria
-- os hashes de todos os PINs para a sessao de um celular. Hash de bcrypt de
-- um PIN de quatro digitos se quebra em segundos fora do servidor.
--
-- Entao a lista de nomes continua vindo de funcao `security definer` que
-- devolve SO id e nome. A tela passa a usa-la tambem depois de entrar, e nao
-- so na porta.

drop policy if exists "coletor le os itens que vai separar" on public.separacao_itens;

create policy "coletor le os itens que vai separar"
on public.separacao_itens
for select
to authenticated
using (
  public.pode('separar_no_coletor')
  and exists (
    select 1 from public.listas_separacao ls
    where ls.id = separacao_itens.lista_id
      and ls.situacao = 'em_separacao'
      and ls.modo = 'coletor'
  )
);

comment on policy "coletor le os itens que vai separar" on public.separacao_itens is
  'O celular ve as pecas das listas que ele pode separar, e so delas.';

drop policy if exists "coletor le as caixas da lista" on public.listas_pacotes;

create policy "coletor le as caixas da lista"
on public.listas_pacotes
for select
to authenticated
using (
  public.pode('separar_no_coletor')
  and exists (
    select 1 from public.listas_separacao ls
    where ls.id = listas_pacotes.lista_id
      and ls.situacao = 'em_separacao'
      and ls.modo = 'coletor'
  )
);

comment on policy "coletor le as caixas da lista" on public.listas_pacotes is
  'O celular ve as caixas das listas que ele pode separar, e so delas.';

create or replace function public.operador_da_porta(p_id uuid)
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path to ''
as $function$
  select o.id, o.nome
  from public.operadores o
  where o.id = p_id and o.ativo and o.pin_hash is not null;
$function$;

comment on function public.operador_da_porta is
  'Um operador, so id e nome. Existe para o cookie do aparelho virar nome sem '
  'dar leitura de `operadores` a ninguem — aquela tabela guarda o pin_hash.';

revoke all on function public.operador_da_porta(uuid) from public;
grant execute on function public.operador_da_porta(uuid) to anon, authenticated;
