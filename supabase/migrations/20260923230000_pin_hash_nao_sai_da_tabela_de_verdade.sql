-- O hash do PIN nao pode ser lido por ninguem. Agora de verdade.
--
-- A migracao anterior revogou o privilegio de COLUNA e nao surtiu efeito: com
-- um GRANT de tabela inteira em pe, revogar coluna nao tira nada. O grant de
-- tabela cobre todas as colunas, inclusive as que a gente acha que revogou —
-- e o pior tipo de correcao e a que parece aplicada e nao esta.
--
-- O caminho certo e revogar a tabela e conceder coluna a coluna. `pin_hash`
-- fica de fora. As funcoes security definer continuam lendo, porque rodam
-- como dona da tabela.
--
-- Por que isso importa: hash de PIN nao e segredo forte. Quatro digitos sao
-- dez mil combinacoes, quebradas offline em segundos. Com a leitura aberta,
-- qualquer pessoa logada descobriria o PIN de um lider e liberaria a propria
-- divergencia.

revoke select on public.operadores from authenticated, anon;

grant select (
  id, nome, papel, tentativas_falhas, bloqueado_ate, ativo,
  criado_em, atualizado_em
) on public.operadores to authenticated, anon;

comment on column public.operadores.pin_hash is
  'Nunca sai da tabela: nao esta no grant de SELECT. So as funcoes security definer leem.';
