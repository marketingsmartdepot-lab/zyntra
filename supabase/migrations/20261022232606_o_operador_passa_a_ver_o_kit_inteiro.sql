-- A outra metade: o operador deixa de ver o kit destrinchado.
--
-- Agora que a composição existe de verdade (BC59-149 virou cuba + torneira +
-- válvula), o `explodir_sku` que mora na lista e na conferência passaria a
-- mostrar TRÊS linhas para uma caixa só. O operador procuraria três peças
-- soltas e não acharia o que bipar — o código de barras é o do kit.
--
-- Então sai dos dois lugares onde gente olha, e fica só na baixa:
--
--   lista de separação / coletor  -> o kit, uma linha, o código do kit
--   abertura da conferência       -> o kit, uma linha
--   baixa no Bling                -> as peças (continua explodindo)
--
-- Produto que não é kit não muda: antes e depois, uma linha.

create or replace view public.listas_itens as
 select lp.lista_id,
    m.sku_id,
    s.codigo,
    s.descricao,
    -- A foto do pedido entra quando o SKU nao tem nenhuma. Nao precisa mais
    -- da guarda de kit que existia aqui: sem explosao, o SKU listado E o SKU
    -- mapeado, entao a foto do anuncio e a foto certa.
    coalesce(min(s.foto_url), min(i.foto_url)) as foto_url,
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
      and coalesce(m.ref_variacao, ''::text) = coalesce(i.ref_variacao, ''::text)
     join public.skus s on s.id = m.sku_id
     left join lateral (
       select c.codigo from public.sku_codigos_barras c
       where c.sku_id = m.sku_id and c.principal limit 1
     ) cb on true
  group by lp.lista_id, m.sku_id, s.codigo, s.descricao, cb.codigo;

-- `create or replace view` APAGA as opcoes. Terceira vez que escrevo isto.
alter view public.listas_itens set (security_invoker = true);

do $$
declare
  v_def text;
  v_novo text;
  v_ancora text;
begin
  v_def := pg_get_functiondef('public.abrir_conferencia(uuid,uuid,uuid)'::regprocedure);

  v_ancora := '  select v_conf, e.sku_id, sum(e.quantidade)::integer';

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'ancora do select da conferencia nao bate';
  end if;

  v_novo := replace(v_def, v_ancora,
                    '  select v_conf, m.sku_id, sum(i.quantidade)::integer');

  v_ancora := '  cross join lateral public.explodir_sku(m.sku_id, i.quantidade) e
  where pa.id = p_pacote_id
  group by e.sku_id;';

  if (length(v_novo) - length(replace(v_novo, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'ancora do explodir da conferencia nao bate';
  end if;

  v_novo := replace(v_novo, v_ancora,
'  where pa.id = p_pacote_id
  group by m.sku_id;');

  execute v_novo;
end $$;

comment on function public.abrir_conferencia is
  'Abre a conferencia de um pacote com o que o cliente comprou. Kit conta como '
  'UMA linha: quem bipa, bipa o codigo do kit. A explosao em pecas mora so na '
  'baixa de estoque.';
