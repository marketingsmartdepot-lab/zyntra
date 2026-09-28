-- `abrir_saida` nunca funcionou. Ela grava `aberta_por = auth.uid()` — um
-- perfil — numa coluna cuja chave estrangeira aponta para `operadores`.
-- Qualquer tentativa de abrir saída estourava com violação de chave. Ninguém
-- tinha tentado ainda: a tabela tem 0 linhas.
--
-- O certo é a coluna, não a função: quem ABRE a saída está na tela do sistema,
-- logado. Quem BIPA cada caixa na porta é identificado por PIN, e esse fica em
-- `saida_pacotes.operador_id`, que continua apontando para operadores.
alter table public.saidas
  drop constraint saidas_aberta_por_fkey,
  add constraint saidas_aberta_por_fkey
    foreign key (aberta_por) references public.perfis(id) on delete set null;

comment on column public.saidas.aberta_por is
  'Quem abriu a saída na tela, pelo login. Quem bipou cada caixa na porta está '
  'em saida_pacotes.operador_id, por PIN.';
