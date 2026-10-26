-- "Quero SEMPRE a foto que puxa do pedido, nao a que esta no catalogo."
-- Decisao da Daniele, e eu tiro a reserva: era `coalesce(anuncio, catalogo)`,
-- vira so o anuncio.
--
-- A diferenca aparece justamente quando a reserva seria usada — ou seja,
-- quando o anuncio nao tem foto. Nessa hora, mostrar a do catalogo PARECE
-- melhor que nao mostrar nada, e nao e:
--
-- A foto do catalogo vem do cadastro, que serve a linha de produto inteira.
-- Ela pode ser de outra cor, de outro tamanho, de uma versao antiga da peca.
-- Quem esta no corredor nao vai parar para desconfiar de uma foto — vai pegar
-- o que se parece com ela. Foto errada nao e informacao ruim, e instrucao
-- errada dada com confianca.
--
-- Sem foto, a tela diz "sem foto", e a pessoa confere pelo codigo e pelo EAN,
-- que e o que ela faria mesmo. Duvida honesta e melhor que certeza falsa.
--
-- Hoje a reserva nem esta sendo usada: 171 de 171 itens de pedido tem foto do
-- anuncio. Entao isto nao muda nada na pratica agora — muda o que acontece no
-- dia em que mudar.

create or replace view public.listas_itens as
select
  lp.lista_id,
  m.sku_id,
  s.codigo,
  s.descricao,
  -- SO o anuncio. Sem reserva no catalogo, de proposito: ver o comentario
  -- desta migracao antes de "consertar" isto com um coalesce.
  min(i.foto_url) as foto_url,
  cb.codigo as codigo_barras,
  sum(i.quantidade)::integer as unidades,
  count(distinct pa.id)::integer as pacotes
from public.listas_pacotes lp
join public.pacotes pa on pa.id = lp.pacote_id
join public.pedidos p on p.envio_id = pa.envio_id
join public.pedido_itens i on i.pedido_id = p.id
join public.mapeamentos_anuncio m
  on m.conta_id = p.conta_id
 and m.ref_anuncio = i.ref_anuncio
 and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
join public.skus s on s.id = m.sku_id
left join lateral (
  select c.codigo
  from public.sku_codigos_barras c
  where c.sku_id = m.sku_id and c.principal
  limit 1
) cb on true
group by lp.lista_id, m.sku_id, s.codigo, s.descricao, cb.codigo;

-- SEXTA vez: `create or replace view` NAO preserva as opcoes. Sem esta linha
-- o `security_invoker` cai calado e a view passa a ler com os direitos do
-- dono, furando a RLS.
alter view public.listas_itens set (security_invoker = true);

comment on view public.listas_itens is
  'O que a lista de separacao espera, por SKU. A foto e SEMPRE a do anuncio '
  'que o cliente comprou — nunca a do catalogo, que serve a linha inteira e '
  'pode ser de outra cor ou versao.';
