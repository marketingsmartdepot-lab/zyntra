-- EU DERRUBEI O ACESSO DA DANIELE. Isto e o conserto.
--
-- `permissoesDeAgora()` lia o perfil assim:
--
--   supabase.from("perfis").select("papel, permissoes").maybeSingle()
--
-- Sem `where`: confiando na RLS para devolver so a linha de quem perguntou.
-- Funcionava porque a politica e `id = auth.uid() OR e_admin()` e so existia
-- UM perfil no sistema — o dela. Para um administrador, "todos" e "o meu"
-- eram a mesma linha.
--
-- Ai eu criei o perfil da conta do aparelho. Virou duas linhas.
-- `maybeSingle()` com duas linhas nao devolve a primeira: devolve erro. O
-- perfil veio nulo, `permissoesDeAgora` devolveu conjunto vazio, e a tela
-- disse "Nenhuma frente esta liberada para esta conta" para a dona do
-- sistema.
--
-- Duas coisas estavam erradas, e as duas foram consertadas:
--
--   AQUI: o perfil do aparelho sai da visao de quem lista gente. Ele nao e
--   gente — e a conta de um celular. Nao deveria aparecer na tela de Pessoas
--   mesmo sem este acidente. Esta migracao devolveu o acesso dela na hora,
--   sem esperar deploy.
--
--   NO CODIGO: a consulta passou a filtrar por `auth.uid()` explicitamente.
--   Politica e guarda, nao e clausula de busca — quando as duas se confundem,
--   o sistema fica certo por coincidencia, e a coincidencia acaba no dia em
--   que alguem insere a segunda linha.

drop policy if exists "cada um le o proprio perfil" on public.perfis;

create policy "cada um le o proprio perfil"
on public.perfis
for select
to authenticated
using (
  id = auth.uid()
  -- Administrador ve todo mundo, menos as contas de aparelho: elas nao sao
  -- pessoas, nao tem o que ser administrado, e so poluem a lista de Pessoas.
  or (public.e_admin() and coalesce(papel::text, '') <> 'aparelho')
);

comment on policy "cada um le o proprio perfil" on public.perfis is
  'Cada pessoa le a si mesma; administrador le a equipe. Conta de aparelho '
  'fica de fora: nao e gente, e em 26/10 a presenca dela na lista derrubou o '
  'acesso da administradora por causa de um maybeSingle() sem where.';
