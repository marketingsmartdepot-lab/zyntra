-- Uma impressora existe para servir uma bancada.
--
-- A rota de impressao resolve a impressora PELA ESTACAO (impressora_da_estacao).
-- Logo, impressora sem estacao nunca recebe trabalho nenhum — mas aceita token
-- e aceita agente. O resultado e uma bancada montada, agente rodando, e nada
-- saindo, sem erro em tela nenhuma. Por isso estacao_id passa a ser obrigatoria.
--
-- E apagar a bancada passa a apagar a impressora junto (era SET NULL). Assim o
-- token morre com ela — privado.agentes_impressao ja cascateia da impressora.
-- Um token que nenhuma tela mostra e um token que ninguem revoga.
--
-- O historico nao se perde: impressoes.impressora_id e SET NULL, entao os
-- trabalhos ja impressos continuam la, apenas sem apontar para uma impressora
-- que nao existe mais.

delete from public.impressoras where estacao_id is null;
delete from public.impressoes where impressora_id is null;

alter table public.impressoras
  drop constraint impressoras_estacao_id_fkey;

alter table public.impressoras
  alter column estacao_id set not null;

alter table public.impressoras
  add constraint impressoras_estacao_id_fkey
  foreign key (estacao_id) references public.estacoes(id) on delete cascade;
