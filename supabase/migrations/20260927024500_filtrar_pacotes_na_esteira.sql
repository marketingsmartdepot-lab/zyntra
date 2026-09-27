-- O time dela filtra para montar a lista de separação. Sem filtro, montar uma
-- lista com 40 caixas de uma conta significa achar 40 linhas no meio de 300.
--
-- A busca acontece no banco, não na tela: filtrar depois de carregar só
-- funciona enquanto cabe tudo na memória, e o dia em que não couber ninguém
-- vai entender por que sumiram pedidos.
--
-- Uma busca só cobre código do pedido, do pack, do envio, nome do cliente,
-- SKU e título do anúncio. Quem está na bancada tem um papel na mão com um
-- número; não sabe se aquele número é pedido, pack ou envio — e não deveria
-- precisar saber.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.pacotes_filtrados(
  p_etapa public.etapa,
  p_busca text default null,
  p_conta uuid default null,
  p_modalidade uuid default null,
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
    and (p_conta is null or pa.conta_id = p_conta)
    and (p_modalidade is null or e.modalidade_id = p_modalidade)
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

revoke all on function public.pacotes_filtrados(public.etapa, text, uuid, uuid, integer) from public;
grant execute on function public.pacotes_filtrados(public.etapa, text, uuid, uuid, integer) to authenticated;

-- Para a busca por texto não varrer tabela inteira quando o galpão crescer.
create index if not exists pedidos_busca_idx on public.pedidos
  using gin ((coalesce(ref_externa,'') || ' ' || coalesce(pack_ref,'') || ' '
              || coalesce(comprador,'')) extensions.gin_trgm_ops);

create index if not exists pedido_itens_busca_idx on public.pedido_itens
  using gin ((coalesce(sku_informado,'') || ' ' || coalesce(titulo,''))
             extensions.gin_trgm_ops);

create index if not exists pacotes_etapa_desde_idx
  on public.pacotes (etapa, etapa_desde);
