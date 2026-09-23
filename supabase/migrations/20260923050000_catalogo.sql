-- ZYNTRA — catálogo: SKUs, códigos de barras e composição de kit
--
-- O espelho do Bling. O ZYNTRA não é dono deste cadastro: ele lê produto,
-- GTIN e composição, e não escreve nada de volta. Saldo continua na Lexos.
--
-- Duas coisas aqui existem só porque a bancada precisa delas, e sem elas a
-- conferência não valida nada:
--
--   1. Código de barras por SKU — o pedido do canal não traz GTIN.
--   2. Composição de kit — o Mercado Livre vende UMA unidade de "pack de 3" e
--      a caixa leva TRÊS. Sem a composição, a estação acusaria excedente em
--      toda venda de kit.

create table public.skus (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descricao text not null,
  foto_url text,
  -- Identificação do produto no ERP de origem.
  erp_ref text,
  ativo boolean not null default true,
  sincronizado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.skus is
  'Espelho do catálogo do ERP. Leitura apenas: o ZYNTRA não cria nem altera produto.';

create index skus_erp_idx on public.skus (erp_ref);

create trigger skus_atualizado_em
  before update on public.skus
  for each row execute function public.tocar_atualizado_em();

-- --------------------------------------------------------- códigos de barras

create table public.sku_codigos_barras (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.skus (id) on delete cascade,
  codigo text not null,
  tipo text not null default 'ean' check (tipo in ('ean', 'interno', 'outro')),
  principal boolean not null default false,
  criado_em timestamptz not null default now(),
  -- Um código nunca pode apontar para dois SKUs: se apontasse, a bipagem
  -- ficaria ambígua e a conferência perderia o sentido.
  unique (codigo)
);

comment on table public.sku_codigos_barras is
  'Vários códigos por SKU: o GTIN do fabricante e a etiqueta interna, quando o produto não tem código.';

create unique index sku_codigo_principal_idx
  on public.sku_codigos_barras (sku_id) where principal;

create index sku_codigos_sku_idx on public.sku_codigos_barras (sku_id);

-- ---------------------------------------------------------------- kits

create table public.sku_componentes (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.skus (id) on delete cascade,
  componente_id uuid not null references public.skus (id) on delete restrict,
  quantidade integer not null check (quantidade > 0),
  criado_em timestamptz not null default now(),
  unique (kit_id, componente_id),
  check (kit_id <> componente_id)
);

comment on table public.sku_componentes is
  'O que vai dentro de um kit. Uma venda de kit vira N unidades na conferência.';

create index sku_componentes_kit_idx on public.sku_componentes (kit_id);

-- ------------------------------------------------- anúncio -> SKU interno

create table public.mapeamentos_anuncio (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  ref_anuncio text not null,
  ref_variacao text,
  sku_id uuid not null references public.skus (id) on delete restrict,
  -- O que o canal mandou como SKU, guardado para auditoria: em 13 contas isso
  -- vem vazio, com prefixo diferente ou divergente do ERP.
  sku_informado text,
  origem text not null default 'automatico' check (origem in ('automatico', 'manual')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.mapeamentos_anuncio is
  'Ponte entre o anúncio do canal e o SKU do ERP. Sem ela, a conferência não sabe o que esperar na caixa.';

-- Variação nula não compara igual a variação nula no unique comum, então o
-- índice normaliza — senão dá para cadastrar o mesmo anúncio duas vezes.
create unique index mapeamentos_anuncio_chave_idx
  on public.mapeamentos_anuncio (conta_id, ref_anuncio, coalesce(ref_variacao, ''));

create trigger mapeamentos_anuncio_atualizado_em
  before update on public.mapeamentos_anuncio
  for each row execute function public.tocar_atualizado_em();

-- -------------------------------------------------------- explodir um kit
--
-- Recursivo porque kit pode conter kit. O limite de profundidade existe para
-- um cadastro circular no ERP não travar a bancada.

create or replace function public.explodir_sku(
  p_sku_id uuid,
  p_quantidade integer default 1
)
returns table (sku_id uuid, quantidade integer)
language sql
stable
set search_path = ''
as $$
  with recursive arvore as (
    select p_sku_id as sku_id, p_quantidade as qtd, 0 as nivel
    union all
    select sc.componente_id, a.qtd * sc.quantidade, a.nivel + 1
    from arvore a
    join public.sku_componentes sc on sc.kit_id = a.sku_id
    where a.nivel < 5
  )
  select a.sku_id, sum(a.qtd)::integer
  from arvore a
  where not exists (
    select 1 from public.sku_componentes sc where sc.kit_id = a.sku_id
  )
  group by a.sku_id;
$$;

comment on function public.explodir_sku is
  'Quantas unidades de cada produto uma venda representa de verdade. Kit vira seus componentes.';

-- ------------------------------------------------- o que ainda não casa
--
-- A fila de anúncios sem SKU é derivada, não tabela: tabela paralela
-- desatualiza e passa a mentir.

create or replace view public.anuncios_sem_sku
with (security_invoker = true)
as
select
  p.conta_id,
  i.ref_anuncio,
  i.ref_variacao,
  max(i.titulo) as titulo,
  max(i.sku_informado) as sku_informado,
  count(*) as itens,
  min(p.criado_em) as visto_pela_primeira_vez
from public.pedido_itens i
join public.pedidos p on p.id = i.pedido_id
left join public.mapeamentos_anuncio m
  on m.conta_id = p.conta_id
 and m.ref_anuncio = i.ref_anuncio
 and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
where m.id is null
group by p.conta_id, i.ref_anuncio, i.ref_variacao;

comment on view public.anuncios_sem_sku is
  'Anúncios que chegaram em pedido e não têm SKU. É a fila de "mapear SKU" da aba Aberto.';

-- ------------------------------------------------- prontidão do catálogo
--
-- Os números que decidem se a estação de conferência é viável ou se há
-- projeto de etiquetagem antes. Sem eles, desenhar a bancada é chute.

create or replace view public.cobertura_catalogo
with (security_invoker = true)
as
select
  (select count(*) from public.skus where ativo) as skus_ativos,
  (select count(distinct s.id)
     from public.skus s
     join public.sku_codigos_barras c on c.sku_id = s.id
    where s.ativo) as skus_com_codigo,
  (select count(distinct kit_id) from public.sku_componentes) as skus_que_sao_kit,
  (select count(*) from public.mapeamentos_anuncio) as anuncios_mapeados,
  (select count(*) from public.anuncios_sem_sku) as anuncios_sem_sku;

comment on view public.cobertura_catalogo is
  'Prontidão da conferência: quantos SKUs têm código de barras e quantos anúncios ainda não casam.';

-- ------------------------------------------------------------------- RLS

alter table public.skus enable row level security;
alter table public.sku_codigos_barras enable row level security;
alter table public.sku_componentes enable row level security;
alter table public.mapeamentos_anuncio enable row level security;

create policy "equipe lê skus" on public.skus
  for select to authenticated using (true);
create policy "equipe lê códigos" on public.sku_codigos_barras
  for select to authenticated using (true);
create policy "equipe lê componentes" on public.sku_componentes
  for select to authenticated using (true);
create policy "equipe lê mapeamentos" on public.mapeamentos_anuncio
  for select to authenticated using (true);

-- Mapear SKU é a ação que desbloqueia pedido parado na aba Aberto, então
-- líder também pode — não só admin. O resto do catálogo vem do ERP.
create policy "líder e admin mapeiam anúncio"
  on public.mapeamentos_anuncio for all to authenticated
  using (public.papel_atual() in ('lider', 'admin'))
  with check (public.papel_atual() in ('lider', 'admin'));

revoke all on function public.explodir_sku(uuid, integer) from public, anon;
grant execute on function public.explodir_sku(uuid, integer) to authenticated;
