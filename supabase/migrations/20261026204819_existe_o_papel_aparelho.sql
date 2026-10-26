-- `aparelho` entra no enum de papel. Nao e gente: e a conta que um celular
-- usa para existir enquanto a pessoa se identifica por PIN em cima dela.
--
-- Precisa ser um papel, e nao uma coluna nova, porque e o papel que
-- `e_da_equipe()` vai consultar para dizer que esta conta NAO e da equipe —
-- e `e_da_equipe()` e o que quase toda politica de RLS deste banco pergunta.
--
-- Migracao separada porque o Postgres nao deixa usar um valor de enum na
-- mesma transacao em que ele nasce.
alter type public.papel add value if not exists 'aparelho';
