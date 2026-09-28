-- A esteira ganha uma sexta etapa, a pedido dela: "depois de pronto pra envio
-- tem que ter uma aba de envio, ai eles saem de pronto para envio para
-- enviado".
--
-- A fronteira que ela escolheu: a caixa sai de Pronto quando é BIPADA NA
-- PORTA. Então:
--   pronto  = conferida e lacrada, na bancada ou no carrinho da doca
--   envio   = bipada na porta, saída ainda aberta, sendo carregada
--   enviado = saída fechada, com motorista e minuta. Foi embora.
--
-- E `encerrado` passa a se chamar `enviado`, que é a palavra dela. Ninguém
-- usou o valor antigo — zero caixas — então a troca é limpa.
--
-- O valor novo do enum entra em migração própria: o Postgres deixa declarar
-- dentro de uma transação, mas não deixa USAR antes dela fechar.
alter type public.etapa add value if not exists 'envio' after 'pronto';
alter type public.etapa rename value 'encerrado' to 'enviado';
