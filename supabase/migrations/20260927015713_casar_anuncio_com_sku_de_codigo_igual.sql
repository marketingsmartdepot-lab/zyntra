-- O código que o Mercado Livre informa no anúncio e o código do catálogo do
-- Bling são o MESMO texto em 8 de 8 itens, e mesmo assim a bancada veria
-- "anúncio sem SKU correspondente" — porque nada ligava os dois. Bloqueio por
-- problema que não existe é pior que bloqueio nenhum: ensina o time a ignorar
-- o aviso.
--
-- Esta função cria o mapeamento quando o código bate. O mapeamento manual
-- continua valendo para quando o vendedor usou outro código no anúncio, e
-- nunca é sobrescrito: `origem` distingue os dois, e o manual ganha.
--
-- Duas cautelas:
--   * comparação sem espaços e sem diferenciar maiúscula — é a mesma peça
--     escrita com desleixo, não outra peça.
--   * se o código casar com MAIS DE UM sku, não casa nenhum. Escolher um
--     mandaria a peça errada para o cliente, e a bipagem confirmaria.
create or replace function public.casar_anuncios_por_codigo(p_conta_id uuid default null)
returns table(casados integer, ambiguos integer, sem_correspondente integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_casados integer := 0;
  v_ambiguos integer := 0;
  v_sem integer := 0;
begin
  with itens as (
    select distinct
      pd.conta_id,
      pi.ref_anuncio,
      pi.ref_variacao,
      upper(btrim(pi.sku_informado)) as codigo
    from public.pedido_itens pi
    join public.pedidos pd on pd.id = pi.pedido_id
    where pi.ref_anuncio is not null
      and coalesce(btrim(pi.sku_informado), '') <> ''
      and (p_conta_id is null or pd.conta_id = p_conta_id)
      and not exists (
        select 1 from public.mapeamentos_anuncio m
        where m.conta_id = pd.conta_id
          and m.ref_anuncio = pi.ref_anuncio
          and coalesce(m.ref_variacao, '') = coalesce(pi.ref_variacao, '')
      )
  ),
  candidatos as (
    select i.*,
           (select array_agg(s.id) from public.skus s
             where upper(btrim(s.codigo)) = i.codigo) as skus
    from itens i
  ),
  novos as (
    insert into public.mapeamentos_anuncio
      (conta_id, ref_anuncio, ref_variacao, sku_id, sku_informado, origem)
    select c.conta_id, c.ref_anuncio, c.ref_variacao, c.skus[1], c.codigo, 'automatico'
    from candidatos c
    where array_length(c.skus, 1) = 1
    on conflict (conta_id, ref_anuncio, coalesce(ref_variacao, '')) do nothing
    returning 1
  )
  select
    (select count(*) from novos),
    (select count(*) from candidatos where array_length(skus, 1) > 1),
    (select count(*) from candidatos where skus is null)
  into v_casados, v_ambiguos, v_sem;

  return query select v_casados, v_ambiguos, v_sem;
end;
$$;

revoke all on function public.casar_anuncios_por_codigo(uuid) from public, anon, authenticated;
