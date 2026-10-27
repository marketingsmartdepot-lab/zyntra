-- CNPJ e serie da NF-e saem do cadastro de empresa emissora. Decisao da
-- Daniele depois de eu mostrar quem le cada campo:
--
--   cnpj               ninguem le
--   serie_nfe          ninguem le
--   razao_social       so a tela
--   nome_curto         so a tela
--   faturador_situacao `pedir_notas_ml` — o unico que faz alguma coisa
--
-- A pergunta dela era certeira: se quem fatura e o Mercado Livre, por que o
-- ZYNTRA guarda CNPJ e serie? E nao guarda para nada. O ML emite com os
-- dados fiscais que estao configurados LA, e nunca recebeu nenhum destes
-- daqui.
--
-- O que sobra e o que o cadastro realmente e: um lugar para dizer "o Faturador
-- desta empresa esta ativo" — que e a chave que libera `pedir_notas_ml` — mais
-- um nome legivel para aparecer na esteira. Agrupar contas por empresa
-- continua valendo: cada empresa dela fatura por ela mesma.
--
-- Campo obrigatorio que ninguem le e pior que campo ausente: ensina o time que
-- preencher direito nao importa, porque nada acontece se estiver errado.
--
-- Seguro de apagar: a tabela esta VAZIA (zero empresas cadastradas), entao
-- nao ha dado para perder. Se um dia valer conferir se a nota voltou do ML
-- emitida pelo CNPJ esperado, a coluna volta — com um leitor junto, desta vez.

alter table public.empresas drop column if exists cnpj;
alter table public.empresas drop column if exists serie_nfe;

comment on table public.empresas is
  'Quem emite a nota. O ZYNTRA nao fatura: quem fatura e o Faturador do ML, '
  'com os dados fiscais configurados la. Isto aqui guarda o nome que aparece '
  'na tela e a chave `faturador_situacao`, que libera o pedido de nota.';
