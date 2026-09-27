-- Eu li a nota do ML e disse que o Faturador dele tinha emitido. Não tinha:
-- quem emitiu foi a Lexos, que sobe o XML para o ML. O próprio ML diz isso no
-- campo `invoice_source`: "imported" quando chegou de fora, "internal" quando
-- o Faturador dele emitiu.
--
-- Para a esteira dá no mesmo — nota autorizada é nota autorizada, e é isso que
-- destrava a separação. Mas para ELA não dá no mesmo: o corte da Lexos é por
-- CNPJ, e sem ver quem emitiu não há como saber se a migração daquele CNPJ
-- aconteceu. Então fica registrado.
--
-- E a resposta traz mais coisa que eu estava jogando fora: a chave de acesso,
-- o endereço do XML e o da DANFE.

alter table public.notas_fiscais
  add column if not exists origem_emissao text,
  add column if not exists emissor_cnpj text,
  add column if not exists emissor_nome text;

comment on column public.notas_fiscais.origem_emissao is
  'De onde veio a nota, como o ML informa: meli = o Faturador do ML emitiu; '
  'importada = alguém emitiu fora e mandou o XML (hoje, a Lexos).';

-- O corpo de privado.buscar_nota_do_pedido é o de 20260927022529 com estes
-- acréscimos: origem_emissao a partir de attributes.invoice_source, o CNPJ e o
-- nome do emissor, a chave de acesso (attributes.invoice_key), e os endereços
-- de XML e DANFE — que o ML devolve como caminho relativo e aqui viram
-- endereço completo, senão quem for baixar depois tem de saber montar.
