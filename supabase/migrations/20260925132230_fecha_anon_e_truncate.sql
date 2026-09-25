-- O `anon` (quem não fez login nenhum) tinha SELECT, INSERT, UPDATE, DELETE e
-- TRUNCATE em 62 tabelas e views. Só o RLS segurava, e só porque nenhuma
-- política menciona `anon`. Isso é um único ponto de falha: uma tabela nova
-- criada sem `enable row level security`, ou uma política escrita `to public`
-- em vez de `to authenticated`, abriria o banco inteiro para a internet.
--
-- Este aplicativo não tem nada público: a tela de login não consulta o banco e
-- todas as outras exigem sessão. O `anon` não precisa de nada aqui — o que ele
-- legitimamente usa são duas funções RPC do agente de impressão, que se
-- autenticam com token próprio e não são tabelas.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- E o mesmo para as próximas tabelas: sem isto, o padrão do Supabase volta a
-- conceder tudo ao anon na próxima tabela criada, e o buraco se refaz sozinho.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- TRUNCATE não passa por RLS. É o único verbo que ignora as políticas por
-- completo: nenhuma regra de linha se aplica, a tabela simplesmente esvazia.
-- Nenhuma tela do sistema trunca nada — isso nunca deveria ter sido concedido.
-- (Não era alcançável pela API REST, que só fala SELECT/INSERT/UPDATE/DELETE e
-- RPC, mas um privilégio errado atrás de uma porta fechada continua errado.)
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- O PIN só pode ser gravado por definir_pin_operador, que hasheia e checa o
-- papel de quem chama. A política de operadores deixa líder e admin escreverem
-- na tabela, então sem esta revogação um líder podia gravar um hash conhecido
-- no PIN de OUTRO líder e liberar divergências no nome dele — e o registro da
-- liberação apontaria a pessoa errada.
revoke insert (pin_hash), update (pin_hash) on public.operadores from authenticated;

comment on column public.operadores.pin_hash is
  'So definir_pin_operador grava aqui. INSERT/UPDATE revogados para que ninguem plante um hash conhecido no PIN de outra pessoa.';
