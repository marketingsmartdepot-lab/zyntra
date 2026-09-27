-- Com mais de uma pessoa separando, "a caixa é minha?" passa a ser uma
-- pergunta de verdade. A lista de separação responde: ela já sabe quem
-- separou. Então ela vira coluna e filtro na esteira.
--
-- Só a lista ATIVA do pacote conta. Um pacote pode ter passado por uma lista
-- antiga, e mostrar as duas faria o filtro devolver caixa que não é daquela
-- pessoa hoje.
create or replace function public.valores_para_filtro(p_etapa etapa)
returns table(coluna text, valor text, rotulo text, quantos integer)
language sql
stable
security definer
set search_path to ''
as $fn$
  with base as (
    select pa.id, pa.conta_id, e.modalidade_id,
           e.etiqueta_conteudo is not null as tem_etiqueta,
           coalesce((select nf.situacao::text from public.notas_fiscais nf
                      where nf.pacote_id = pa.id
                      order by nf.atualizado_em desc limit 1), 'sem') as nf,
           (select lp.lista_id from public.listas_pacotes lp
             where lp.pacote_id = pa.id and lp.ativa
             order by lp.adicionado_em desc limit 1) as lista_id
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
  union all
  -- O rótulo leva o nome de quem separou: "LS-0011" sozinho não diz de quem é.
  select 'separacao',
         coalesce(b.lista_id::text, 'sem'),
         coalesce(ls.codigo || coalesce(' · ' || op.nome, ''), 'Sem lista'),
         count(*)::int
    from base b
    left join public.listas_separacao ls on ls.id = b.lista_id
    left join public.operadores op on op.id = ls.separador_id
   group by 1,2,3
  order by 1, 3;
$fn$;

grant execute on function public.valores_para_filtro(etapa) to authenticated;

create or replace function public.pacotes_filtrados(
  p_etapa etapa,
  p_busca text default null,
  p_contas uuid[] default null,
  p_modalidades uuid[] default null,
  p_nf text[] default null,
  p_etiqueta text[] default null,
  p_limite integer default 200,
  p_listas text[] default null
) returns table(id uuid)
language sql
stable
security definer
set search_path to ''
as $fn$
  select pa.id
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  where public.e_da_equipe()
    and pa.etapa = p_etapa
    and (p_contas is null or cardinality(p_contas) = 0 or pa.conta_id = any(p_contas))
    and (p_modalidades is null or cardinality(p_modalidades) = 0
         or e.modalidade_id = any(p_modalidades))
    and (p_nf is null or cardinality(p_nf) = 0 or coalesce((
          select nf.situacao::text from public.notas_fiscais nf
          where nf.pacote_id = pa.id order by nf.atualizado_em desc limit 1
        ), 'sem') = any(p_nf))
    and (p_etiqueta is null or cardinality(p_etiqueta) = 0
         or (case when e.etiqueta_conteudo is not null then 'obtida' else 'pendente' end)
            = any(p_etiqueta))
    -- 'sem' é uma escolha legítima: são as caixas que ainda não entraram em
    -- lista nenhuma, e alguém precisa enxergá-las.
    and (p_listas is null or cardinality(p_listas) = 0
         or coalesce((
              select lp.lista_id::text from public.listas_pacotes lp
              where lp.pacote_id = pa.id and lp.ativa
              order by lp.adicionado_em desc limit 1
            ), 'sem') = any(p_listas))
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
$fn$;

grant execute on function public.pacotes_filtrados(
  etapa, text, uuid[], uuid[], text[], text[], integer, text[]) to authenticated;
