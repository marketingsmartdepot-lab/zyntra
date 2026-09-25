-- O verificador aponta `pg_net` instalada no schema publico. Fica assim, de
-- proposito, e o motivo esta aqui para ninguem reabrir o assunto:
--
-- 1. `pg_net` nao suporta `alter extension ... set schema`.
-- 2. Os 15 objetos dela vivem todos no schema `net`, nenhum no `public` — o
--    aviso e sobre o registro da extensao, nao sobre exposicao.
-- 3. A unica saida seria derrubar e recriar, o que interromperia a fila de
--    baixas de estoque para resolver algo que nao e risco.
--
-- Trocar risco real por cosmetico e um mau negocio.

comment on extension pg_net is
  'Fica no schema publico porque nao suporta SET SCHEMA. Todos os objetos dela estao em `net`; nenhum em `public`. Ver migracao registra_por_que_pg_net_fica_no_publico.';
