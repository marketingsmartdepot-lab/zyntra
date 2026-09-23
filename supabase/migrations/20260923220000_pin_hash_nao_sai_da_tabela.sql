-- O hash do PIN nao pode ser lido por ninguem.
--
-- ATENCAO: esta migracao NAO surtiu efeito. Fica no historico porque foi
-- aplicada no banco e porque o erro vale ser lembrado: com um GRANT de tabela
-- inteira em pe, revogar privilegio de COLUNA nao tira nada. A correcao que
-- funciona esta na migracao seguinte.

revoke select (pin_hash) on public.operadores from authenticated, anon;

comment on column public.operadores.pin_hash is
  'Nunca sai da tabela: SELECT desta coluna e revogado. So as funcoes security definer leem.';
