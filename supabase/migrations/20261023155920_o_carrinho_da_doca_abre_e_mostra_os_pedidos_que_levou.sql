-- "Carrinhos de hoje" dizia "06 caixas" e nao dizia QUAIS. Pedido da Daniele
-- em 23/10: clicar no carrinho e ver os pedidos que foram nele.
--
-- Nao reaproveito `pacotes_na_doca`: aquela view existe para montar a doca e
-- por isso ESCONDE o que ja saiu do galpao. Aqui e o contrario — o carrinho de
-- 6 caixas com 4 ja despachadas precisa mostrar as 6, senao a conta na tela
-- nao fecha com a lista aberta embaixo dela.
--
-- O pedido vem agregado porque um pacote pode levar mais de um: venda em pack
-- do Mercado Livre e um envio com varios pedidos dentro.

create or replace view public.entregas_doca_itens as
select
  ep.entrega_id,
  pa.id                                   as pacote_id,
  pa.etapa::text                          as etapa,
  e.ref_externa                           as envio_ref,
  ct.apelido                              as conta,
  coalesce(m.nome, 'nao classificada')    as modalidade,
  -- Varios pedidos no mesmo pacote: mostra todos, em ordem estavel.
  (select string_agg(p.ref_externa, ', ' order by p.ref_externa)
     from public.pedidos p where p.envio_id = e.id)        as pedidos,
  (select string_agg(distinct p.comprador, ', ')
     from public.pedidos p
    where p.envio_id = e.id and coalesce(btrim(p.comprador),'') <> '') as comprador,
  exists (select 1 from public.saida_pacotes sp where sp.pacote_id = pa.id) as ja_saiu,
  (select min(s.aberta_em) from public.saida_pacotes sp
     join public.saidas s on s.id = sp.saida_id
    where sp.pacote_id = pa.id)                            as saiu_em,
  ed.entregue_em
from public.entregas_doca_pacotes ep
join public.entregas_doca ed on ed.id = ep.entrega_id
join public.pacotes pa       on pa.id = ep.pacote_id
join public.envios e         on e.id = pa.envio_id
join public.contas ct        on ct.id = pa.conta_id
left join public.modalidades m on m.id = e.modalidade_id;

-- QUARTA vez que escrevo isto: `create or replace view` NAO preserva as
-- opcoes da view. O `security_invoker` cai calado, e sem ele a view passa a
-- ler com os direitos do dono, furando a RLS para quem abrir a tela.
alter view public.entregas_doca_itens set (security_invoker = true);

comment on view public.entregas_doca_itens is
  'Os pacotes de cada carrinho da doca, INCLUSIVE os que ja sairam — ao '
  'contrario de pacotes_na_doca, que esconde os despachados.';
