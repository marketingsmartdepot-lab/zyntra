-- Filtro na coluna, como ela trabalha: abre a coluna, marca os valores que
-- interessam, e pode marcar mais de um. Um seletor de valor único obrigaria a
-- separar Flex e Agência em duas passagens, quando o time separa os dois no
-- mesmo carrinho.
--
-- Por isso os parâmetros são LISTAS. Lista vazia ou nula significa "todos" —
-- o estado em que a tela abre.
--
-- Depois ela cortou o escopo: só modalidade de entrega filtra na tela. As
-- outras colunas do filtro continuam aqui porque custam nada e o dia em que
-- ela pedir já estão prontas.

create or replace function public.pacotes_filtrados(
  p_etapa public.etapa,
  p_busca text default null,
  p_contas uuid[] default null,
  p_modalidades uuid[] default null,
  p_nf text[] default null,
  p_etiqueta text[] default null,
  p_limite integer default 200
) returns table(id uuid)
language sql
stable
security definer
set search_path to ''
as $$
  select pa.id
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  where public.e_da_equipe()
    and pa.etapa = p_etapa
    and (p_contas is null or cardinality(p_contas) = 0 or pa.conta_id = any(p_contas))
    and (p_modalidades is null or cardinality(p_modalidades) = 0
         or e.modalidade_id = any(p_modalidades))
    -- A situação da nota é a da nota mais recente da caixa; sem nota, 'sem'.
    and (p_nf is null or cardinality(p_nf) = 0 or coalesce((
          select nf.situacao::text from public.notas_fiscais nf
          where nf.pacote_id = pa.id order by nf.atualizado_em desc limit 1
        ), 'sem') = any(p_nf))
    and (p_etiqueta is null or cardinality(p_etiqueta) = 0
         or (case when e.etiqueta_conteudo is not null then 'obtida' else 'pendente' end)
            = any(p_etiqueta))
    and (
      coalesce(btrim(p_busca), '') = ''
      or e.ref_externa ilike '%' || btrim(p_busca) || '%'
      or exists (
        select 1 from public.pedidos pd
        where pd.envio_id = pa.envio_id
          and (pd.ref_externa ilike '%' || btrim(p_busca) || '%'
            or coalesce(pd.pack_ref, '') ilike '%' || btrim(p_busca) || '%'
            or coalesce(pd.comprador, '') ilike '%' || btrim(p_busca) || '%')
      )
      or exists (
        select 1
        from public.pedidos pd
        join public.pedido_itens pi on pi.pedido_id = pd.id
        left join public.mapeamentos_anuncio m
          on m.conta_id = pd.conta_id
         and m.ref_anuncio = pi.ref_anuncio
         and coalesce(m.ref_variacao, '') = coalesce(pi.ref_variacao, '')
        left join public.skus s on s.id = m.sku_id
        where pd.envio_id = pa.envio_id
          and (coalesce(s.codigo, '') ilike '%' || btrim(p_busca) || '%'
            or coalesce(pi.sku_informado, '') ilike '%' || btrim(p_busca) || '%'
            or coalesce(pi.titulo, '') ilike '%' || btrim(p_busca) || '%')
      )
    )
  order by pa.etapa_desde
  limit greatest(least(coalesce(p_limite, 200), 500), 1);
$$;

drop function if exists public.pacotes_filtrados(public.etapa, text, uuid, uuid, integer);

revoke all on function public.pacotes_filtrados(public.etapa, text, uuid[], uuid[], text[], text[], integer) from public;
grant execute on function public.pacotes_filtrados(public.etapa, text, uuid[], uuid[], text[], text[], integer) to authenticated;

/**
 * Os valores que existem em cada coluna, nesta etapa, com quantos há de cada.
 *
 * O filtro mostra só o que realmente aparece na tela. Oferecer uma modalidade
 * que não tem nenhum pedido nesta aba é dar uma opção que não muda nada, e
 * quem marca fica sem entender por que a lista esvaziou.
 */
create or replace function public.valores_para_filtro(p_etapa public.etapa)
returns table(coluna text, valor text, rotulo text, quantos integer)
language sql
stable
security definer
set search_path to ''
as $$
  with base as (
    select pa.id, pa.conta_id, e.modalidade_id,
           e.etiqueta_conteudo is not null as tem_etiqueta,
           coalesce((select nf.situacao::text from public.notas_fiscais nf
                      where nf.pacote_id = pa.id
                      order by nf.atualizado_em desc limit 1), 'sem') as nf
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    where public.e_da_equipe() and pa.etapa = p_etapa
  )
  select 'conta', b.conta_id::text, ct.apelido, count(*)::int
    from base b join public.contas ct on ct.id = b.conta_id
   group by 1,2,3
  union all
  select 'modalidade', b.modalidade_id::text, m.nome, count(*)::int
    from base b join public.modalidades m on m.id = b.modalidade_id
   group by 1,2,3
  union all
  select 'nf', b.nf,
         case b.nf when 'sem' then 'Sem nota'
                   when 'autorizada' then 'Autorizada'
                   when 'rejeitada' then 'Rejeitada'
                   when 'cancelada' then 'Cancelada'
                   when 'solicitada' then 'Solicitada'
                   else b.nf end,
         count(*)::int
    from base b group by 1,2,3
  union all
  select 'etiqueta',
         case when b.tem_etiqueta then 'obtida' else 'pendente' end,
         case when b.tem_etiqueta then 'Obtida' else 'Pendente' end,
         count(*)::int
    from base b group by 1,2,3
  order by 1, 3;
$$;

revoke all on function public.valores_para_filtro(public.etapa) from public;
grant execute on function public.valores_para_filtro(public.etapa) to authenticated;
