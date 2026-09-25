-- O painel passa a responder "como o negocio vai", nao so "o que esta parado".
--
-- Tres decisoes que mudam o numero:
--
-- 1. A venda conta pelo PAGAMENTO (`pago_em`), nao pela criacao. Pedido criado
--    e nao pago nao e venda, e contar por criacao inflaria o dia.
-- 2. Cancelado sai da conta, sempre.
-- 3. O dia e o dia de Sao Paulo, nao UTC. Venda das 21h nao pode cair no dia
--    seguinte porque o servidor esta em outro fuso.

create or replace function public.painel_vendas_por_dia(p_dias integer default 30)
returns table (
  dia date,
  total numeric,
  pedidos integer,
  fim_de_semana boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  -- generate_series preenche o dia sem venda com zero. Sem isso o dia some e
  -- as barras ficam mais juntas onde nao houve venda — o grafico mentiria
  -- sobre o ritmo.
  select
    d.dia::date,
    coalesce(sum(p.total), 0)::numeric,
    count(p.id)::integer,
    extract(isodow from d.dia) >= 6
  from generate_series(
         (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) - 1),
         (now() at time zone 'America/Sao_Paulo')::date,
         interval '1 day'
       ) d(dia)
  left join public.pedidos p
    on (p.pago_em at time zone 'America/Sao_Paulo')::date = d.dia::date
   and p.cancelado_em is null
  group by d.dia
  order by d.dia;
$$;

comment on function public.painel_vendas_por_dia is
  'Vendas por dia, pelo pagamento e no fuso de Sao Paulo. Dia sem venda vem com zero para o grafico nao mentir sobre o ritmo.';

/**
 * Os numeros do periodo, com os do periodo ANTERIOR do mesmo tamanho.
 *
 * O numero sozinho nao diz se esta bom. "R$ 84.320" e um fato; "R$ 84.320,
 * 12% acima" e uma informacao.
 */
create or replace function public.painel_resumo(p_dias integer default 30)
returns table (
  faturamento numeric,
  pedidos integer,
  unidades integer,
  ticket numeric,
  faturamento_antes numeric,
  pedidos_antes integer,
  ticket_antes numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with limites as (
    select
      (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) - 1) as de,
      (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) * 2 - 1) as de_antes,
      (now() at time zone 'America/Sao_Paulo')::date - greatest(p_dias, 1) as ate_antes
  ),
  base as (
    select
      p.total,
      p.unidades,
      (p.pago_em at time zone 'America/Sao_Paulo')::date as dia
    from public.pedidos p, limites l
    where p.cancelado_em is null
      and p.pago_em is not null
      and (p.pago_em at time zone 'America/Sao_Paulo')::date >= l.de_antes
  ),
  agora as (
    select
      coalesce(sum(b.total), 0)::numeric as faturamento,
      count(*)::integer as pedidos,
      coalesce(sum(b.unidades), 0)::integer as unidades
    from base b, limites l
    where b.dia >= l.de
  ),
  antes as (
    select
      coalesce(sum(b.total), 0)::numeric as faturamento,
      count(*)::integer as pedidos
    from base b, limites l
    where b.dia between l.de_antes and l.ate_antes
  )
  select
    a.faturamento,
    a.pedidos,
    a.unidades,
    case when a.pedidos > 0 then round(a.faturamento / a.pedidos, 2) else 0 end,
    n.faturamento,
    n.pedidos,
    case when n.pedidos > 0 then round(n.faturamento / n.pedidos, 2) else 0 end
  from agora a, antes n;
$$;

comment on function public.painel_resumo is
  'Os numeros do periodo e os do periodo anterior do mesmo tamanho, para a tela mostrar variacao.';

/**
 * Os mais vendidos, por unidade.
 *
 * Agrupa pelo SKU quando o anuncio esta mapeado. Quando NAO esta, agrupa pelo
 * proprio anuncio em vez de sumir da lista — anuncio sem SKU costuma ser
 * justamente o que ninguem cadastrou ainda, e some-lo esconderia o problema.
 */
create or replace function public.painel_produtos(
  p_dias integer default 30,
  p_limite integer default 6
)
returns table (
  chave text,
  titulo text,
  codigo text,
  foto_url text,
  unidades integer,
  receita numeric,
  mapeado boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(s.id::text, 'anuncio:' || i.ref_anuncio) as chave,
    coalesce(s.descricao, max(i.titulo), i.ref_anuncio) as titulo,
    s.codigo,
    coalesce(max(i.foto_url), s.foto_url) as foto_url,
    sum(i.quantidade)::integer as unidades,
    coalesce(sum(i.quantidade * i.preco_unitario), 0)::numeric as receita,
    (s.id is not null) as mapeado
  from public.pedidos p
  join public.pedido_itens i on i.pedido_id = p.id
  left join public.mapeamentos_anuncio m
    on m.conta_id = p.conta_id
   and m.ref_anuncio = i.ref_anuncio
   and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
  left join public.skus s on s.id = m.sku_id
  where p.cancelado_em is null
    and p.pago_em is not null
    and (p.pago_em at time zone 'America/Sao_Paulo')::date
        >= (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) - 1)
  group by s.id, s.codigo, s.descricao, s.foto_url, i.ref_anuncio
  order by sum(i.quantidade) desc
  limit greatest(p_limite, 1);
$$;

comment on function public.painel_produtos is
  'Os mais vendidos por unidade. Anuncio sem SKU aparece pelo proprio anuncio em vez de sumir — some-lo esconderia o cadastro que falta.';

revoke execute on function public.painel_vendas_por_dia(integer) from public, anon;
revoke execute on function public.painel_resumo(integer) from public, anon;
revoke execute on function public.painel_produtos(integer, integer) from public, anon;
grant execute on function public.painel_vendas_por_dia(integer) to authenticated;
grant execute on function public.painel_resumo(integer) to authenticated;
grant execute on function public.painel_produtos(integer, integer) to authenticated;
