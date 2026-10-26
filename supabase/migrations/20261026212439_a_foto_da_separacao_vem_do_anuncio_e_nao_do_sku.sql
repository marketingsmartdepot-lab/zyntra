-- A foto da lista de separacao passa a vir do ANUNCIO, e so cai para a do
-- SKU se o anuncio nao tiver. Era o contrario.
--
-- A Daniele lembrou da regra combinada em 22/10: a foto desce do anuncio
-- junto com o pedido. O `coalesce` estava na ordem inversa.
--
-- O dado concorda, e com folga:
--
--   171 de 171 itens de pedido tem foto do anuncio
--   11 SKUs tem foto SO por essa via
--
-- Inverter nao perde nada e ganha 11 de cara. E e o certo pelo uso: quem esta
-- no corredor confere a peca contra o que o CLIENTE comprou, nao contra uma
-- foto de cadastro que pode ser generica, antiga, ou de outra cor da mesma
-- linha. Foto de cadastro errada e pior que foto nenhuma — ela faz alguem
-- pegar a peca errada com confianca.

create or replace view public.listas_itens as
select
  lp.lista_id,
  m.sku_id,
  s.codigo,
  s.descricao,
  -- ANUNCIO primeiro. O cadastro e a reserva.
  coalesce(min(i.foto_url), min(s.foto_url)) as foto_url,
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

-- QUINTA vez que escrevo isto: `create or replace view` NAO preserva as
-- opcoes. O `security_invoker` cai calado, e sem ele a view passa a ler com
-- os direitos do dono — furando a RLS para quem abrir a tela.
alter view public.listas_itens set (security_invoker = true);

comment on view public.listas_itens is
  'O que a lista de separacao espera, por SKU. A foto vem do ANUNCIO que o '
  'cliente comprou, e so cai para a do cadastro se o anuncio nao tiver.';
