-- A baixa de estoque no Bling, na autorizacao da NF-e.
--
-- Por que na autorizacao e nao na saida da caixa: o Bling reflete estoque para
-- a Lexos, e a Lexos controla os anuncios. Enquanto a baixa nao acontece, a
-- peca continua disponivel e o Mercado Livre pode vender de novo. Entre a
-- venda e a expedicao passam horas.
--
-- O desenho e de CAIXA DE SAIDA, nao de chamada direta: a nota autoriza, a
-- baixa entra na fila, e alguem drena. Chamar o Bling dentro da transacao da
-- nota significaria que uma instabilidade do Bling impediria a nota de ser
-- registrada — e a nota ja existe no SEFAZ a essa altura.
--
-- A trava que importa e o indice unico por (pedido, tipo). Retry de rede,
-- reprocessamento, dois cliques: nada disso baixa o estoque duas vezes.
-- Estoque corrompido em treze contas so aparece semanas depois, quando alguem
-- vende o que nao tem.

create table if not exists public.erp_config (
  id boolean primary key default true check (id),
  deposito_ref text,
  ativo boolean not null default false,
  atualizado_em timestamptz not null default now()
);

comment on table public.erp_config is
  'Configuracao do ERP de estoque (Bling). Uma linha so — a trava no id garante.';
comment on column public.erp_config.ativo is
  'Enquanto false, a baixa entra na fila e nao e enviada. Mesma logica da emissao: liga-se olhando.';

insert into public.erp_config (id) values (true) on conflict (id) do nothing;

alter table public.erp_config enable row level security;
create policy "equipe le config do erp" on public.erp_config
  for select to authenticated using (true);
create policy "admin escreve config do erp" on public.erp_config
  for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

create table if not exists privado.credenciais_erp (
  id boolean primary key default true check (id),
  access_token text,
  refresh_token text,
  expira_em timestamptz,
  atualizado_em timestamptz not null default now()
);

comment on table privado.credenciais_erp is
  'Token do Bling. Fora do schema publico: so a Edge Function, com a chave de servico, enxerga.';

alter table privado.credenciais_erp enable row level security;

create table if not exists public.baixas_estoque (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  tipo text not null default 'baixa' check (tipo in ('baixa', 'estorno')),
  situacao text not null default 'pendente'
    check (situacao in ('pendente', 'enviada', 'erro')),
  tentativas integer not null default 0,
  erro text,
  ref_externa text,
  criada_em timestamptz not null default now(),
  enviada_em timestamptz
);

-- ESTA e a trava. Um pedido tem no maximo uma baixa e um estorno, para sempre.
create unique index if not exists baixas_estoque_uma_por_pedido
  on public.baixas_estoque (pedido_id, tipo);

create index if not exists baixas_estoque_pendentes
  on public.baixas_estoque (criada_em) where situacao <> 'enviada';

comment on table public.baixas_estoque is
  'Caixa de saida das baixas no ERP. O indice unico por (pedido, tipo) e o que impede baixar o mesmo pedido duas vezes.';

alter table public.baixas_estoque enable row level security;
create policy "equipe le baixas" on public.baixas_estoque
  for select to authenticated using (true);

/**
 * O que baixar de um pedido.
 *
 * Passa por `explodir_sku` porque a estrutura preve kit. Sem componentes
 * cadastrados — que e o caso hoje — ela devolve o proprio SKU com a quantidade
 * vendida, entao o caminho simples sai de graca.
 */
create or replace function public.itens_para_baixa(p_pedido_id uuid)
returns table (sku_id uuid, sku_codigo text, erp_ref text, quantidade integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.sku_id,
    s.codigo,
    s.erp_ref,
    sum(e.quantidade)::integer
  from public.pedidos p
  join public.pedido_itens i on i.pedido_id = p.id
  join public.mapeamentos_anuncio m
    on m.conta_id = p.conta_id
   and m.ref_anuncio = i.ref_anuncio
   and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
  cross join lateral public.explodir_sku(m.sku_id, i.quantidade) e(sku_id, quantidade)
  join public.skus s on s.id = e.sku_id
  where p.id = p_pedido_id
  group by e.sku_id, s.codigo, s.erp_ref;
$$;

comment on function public.itens_para_baixa is
  'O que sai da prateleira por causa deste pedido.';

revoke execute on function public.itens_para_baixa(uuid) from public, anon;
grant execute on function public.itens_para_baixa(uuid) to authenticated;
