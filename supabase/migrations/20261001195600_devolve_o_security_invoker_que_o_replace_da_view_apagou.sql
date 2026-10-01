-- `create or replace view` não preserva as opções da view: ao recriar
-- listas_resumo para acrescentar a coluna `modo`, ela voltou ao padrão do
-- Postgres (security definer) e passou a ler as tabelas-base com os direitos
-- de quem a criou, não de quem consulta. Na prática não expõe nada — todo o
-- time já lê essas tabelas — mas é uma trava a menos do que antes, e a view
-- não estava na lista do lint antes desta mudança.
--
-- Lição para a próxima vez que uma coluna entrar numa view: conferir as
-- opções depois do replace, não só o resultado do select.

alter view public.listas_resumo set (security_invoker = true);
