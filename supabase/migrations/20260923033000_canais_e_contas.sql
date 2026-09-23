-- ZYNTRA — canais, pools de estoque e contas
--
-- A grade da Integração. Duas decisões estruturais moram aqui:
--
-- 1. Nada se chama `ml_*`. O modelo nasce multicanal mesmo com só o Mercado
--    Livre ligado agora — renomear isso depois, com 13 contas em produção, é
--    dívida que não se paga.
-- 2. Empresa emissora e dono do estoque são vínculos INDEPENDENTES. Na Lexos
--    eles já divergem hoje: conta que fatura pela Durace consome estoque da
--    Smart Depot. Modelar como um campo só quebraria no primeiro dia.

-- ---------------------------------------------------------------- canais

create table public.canais (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  -- Full é canal à parte de propósito: a mercadoria está no galpão do ML,
  -- então esses pedidos nunca entram na esteira.
  entra_na_esteira boolean not null default true,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

comment on table public.canais is
  'Marketplaces. Só o Mercado Livre é implementado agora; os outros existem no modelo para não virar reescrita.';

insert into public.canais (slug, nome, entra_na_esteira) values
  ('mercado_livre', 'Mercado Livre', true),
  ('mercado_livre_full', 'Mercado Livre Full', false);

-- --------------------------------------------------------- pools de estoque

create table public.pools_estoque (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  -- De quem é a mercadoria na prateleira. Hoje, no escopo do ML, é sempre a
  -- Smart Depot — mas quem fatura varia, e é por isso que são tabelas
  -- separadas.
  empresa_dona_id uuid references public.empresas (id) on delete restrict,
  -- Identificação do depósito no ERP. O saldo continua sendo da Lexos: o
  -- ZYNTRA não lê nem escreve estoque, só registra qual pool cada conta usa.
  erp_deposito_ref text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.pools_estoque is
  'De onde sai a mercadoria. Registro e exibição — o controle de saldo fica na Lexos.';

create trigger pools_estoque_atualizado_em
  before update on public.pools_estoque
  for each row execute function public.tocar_atualizado_em();

-- --------------------------------------------------------------- contas

create table public.contas (
  id uuid primary key default gen_random_uuid(),
  canal_id uuid not null references public.canais (id) on delete restrict,

  -- Identificador da conta no marketplace (no ML, o user_id do vendedor).
  ref_externa text,
  apelido text not null,

  -- Os dois vínculos, independentes.
  empresa_emissora_id uuid references public.empresas (id) on delete restrict,
  pool_estoque_id uuid references public.pools_estoque (id) on delete restrict,

  -- Uma conta só entra na esteira depois de ter emitido uma nota autorizada
  -- de ponta a ponta naquele CNPJ. Nunca por lote.
  entra_na_esteira boolean not null default false,
  importar_desde timestamptz,

  situacao text not null default 'desconectada'
    check (situacao in ('desconectada', 'conectada', 'erro')),
  ultimo_erro text,
  conectada_em timestamptz,

  -- Disjuntor da emissão automática: é por conta, não por CNPJ. Uma conta mal
  -- configurada dispara centenas de rejeições em minutos se ninguém parar.
  emissao_automatica boolean not null default false,
  emissao_pausada_em timestamptz,
  emissao_pausa_motivo text,

  criada_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (canal_id, ref_externa)
);

comment on table public.contas is
  'Uma linha por conta de marketplace. É a grade da Integração.';
comment on column public.contas.empresa_emissora_id is
  'Quem fatura. Não é necessariamente a dona do estoque.';
comment on column public.contas.pool_estoque_id is
  'De onde sai a mercadoria. Independente de quem fatura.';
comment on column public.contas.emissao_pausada_em is
  'Preenchido pelo disjuntor depois de N rejeições seguidas. Enquanto estiver preenchido, nenhuma nota é pedida para esta conta.';

create index contas_canal_idx on public.contas (canal_id);
create index contas_esteira_idx on public.contas (entra_na_esteira) where entra_na_esteira;

create trigger contas_atualizado_em
  before update on public.contas
  for each row execute function public.tocar_atualizado_em();

-- ------------------------------------------------------------ credenciais
--
-- Token de acesso não mora em schema exposto. O `privado` fica fora da API
-- do PostgREST, então nem com a chave publicável dá para chegar nele — só o
-- lado servidor, com a chave de serviço.

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create table privado.credenciais_conta (
  conta_id uuid primary key references public.contas (id) on delete cascade,
  access_token text,
  refresh_token text,
  expira_em timestamptz,
  escopo text,
  -- O refresh token do ML rotaciona e é de uso único. Duas renovações ao
  -- mesmo tempo derrubam uma à outra, então a renovação pega trava aqui.
  trava_ate timestamptz,
  renovado_em timestamptz,
  renovacoes integer not null default 0,
  atualizado_em timestamptz not null default now()
);

comment on schema privado is
  'Fora do PostgREST. Segredo não passa pela chave publicável.';
comment on column privado.credenciais_conta.trava_ate is
  'Trava de renovação: o refresh token do ML é de uso único e rotaciona.';

create trigger credenciais_conta_atualizado_em
  before update on privado.credenciais_conta
  for each row execute function public.tocar_atualizado_em();

-- ------------------------------------------------------------------- RLS

alter table public.canais enable row level security;
alter table public.pools_estoque enable row level security;
alter table public.contas enable row level security;
alter table privado.credenciais_conta enable row level security;

create policy "equipe lê canais"
  on public.canais for select to authenticated using (true);
create policy "admin escreve canais"
  on public.canais for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

create policy "equipe lê pools"
  on public.pools_estoque for select to authenticated using (true);
create policy "admin escreve pools"
  on public.pools_estoque for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

create policy "equipe lê contas"
  on public.contas for select to authenticated using (true);
create policy "admin escreve contas"
  on public.contas for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

-- Credenciais: nenhuma política. Sem política e com RLS ligado, ninguém lê —
-- nem `authenticated`. Só a chave de serviço, que passa por cima do RLS.
