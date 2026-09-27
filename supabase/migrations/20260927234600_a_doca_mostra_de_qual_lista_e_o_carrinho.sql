-- Agora que o carrinho É a lista, a doca precisa dizer isso. Sem a coluna, a
-- tela mostra "LS-0011" e parece um código de carrinho qualquer — e perde o
-- que a mudança toda serve para responder: de quem é essa pilha.
--
-- Colunas novas vão no FIM: o Postgres não deixa inserir no meio de uma view
-- existente (ele entende como renomear a coluna que estava naquela posição).
create or replace view public.entregas_doca_resumo
with (security_invoker = true)
as
 SELECT ed.id,
    ed.codigo,
    ed.entregue_por,
    ed.entregue_em,
    o.nome AS operador,
    count(ep.pacote_id)::integer AS pacotes,
    count(sp.pacote_id)::integer AS ja_sairam,
    ed.lista_id,
    (ed.lista_id is not null) AS e_uma_lista
   FROM entregas_doca ed
     LEFT JOIN operadores o ON o.id = ed.operador_id
     LEFT JOIN entregas_doca_pacotes ep ON ep.entrega_id = ed.id
     LEFT JOIN saida_pacotes sp ON sp.pacote_id = ep.pacote_id
  GROUP BY ed.id, ed.codigo, ed.entregue_por, ed.entregue_em, o.nome, ed.lista_id;

grant select on public.entregas_doca_resumo to authenticated;
