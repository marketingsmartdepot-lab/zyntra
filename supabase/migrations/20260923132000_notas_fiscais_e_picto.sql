alter table public.canais
  add column if not exists sigla text,
  add column if not exists cor text,
  add column if not exists cor_texto text;

update public.canais set sigla='ML', cor='#FFE600', cor_texto='#2D3277' where slug='mercado_livre';
update public.canais set sigla='FULL', cor='#2D3277', cor_texto='#FFE600' where slug='mercado_livre_full';

create type public.nota_situacao as enum
  ('solicitada','autorizada','rejeitada','cancelada');

create table public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  pacote_id uuid references public.pacotes (id) on delete set null,
  chave_idempotencia text not null unique,
  pedidos_ref text[] not null default '{}',
  tipo text not null default 'venda' check (tipo in ('venda','devolucao','outro')),
  situacao public.nota_situacao not null default 'solicitada',
  ref_externa text,
  status_canal text,
  serie text,
  numero bigint,
  chave_acesso text,
  codigo_status integer,
  descricao_status text,
  autorizada_em timestamptz,
  xml_url text,
  danfe_url text,
  erro_codigo text,
  erro_mensagem text,
  campo_a_corrigir text,
  cancelada_em timestamptz,
  cancelamento_protocolo text,
  cancelamento_motivo text,
  tentativas integer not null default 0,
  solicitada_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.notas_fiscais is
  'Nota emitida pelo Faturador do ML. A chave de idempotencia e do CONJUNTO de pedidos: carrinho gera uma nota unica para N vendas.';
comment on column public.notas_fiscais.campo_a_corrigir is
  'front_properties.correctedBy do ML: qual campo consertar. E o que permite agrupar a aba Aberto por causa.';

create index notas_fiscais_pacote_idx on public.notas_fiscais (pacote_id);
create index notas_fiscais_causa_idx on public.notas_fiscais (erro_codigo)
  where situacao = 'rejeitada';

create trigger notas_fiscais_atualizado_em
  before update on public.notas_fiscais
  for each row execute function public.tocar_atualizado_em();

alter table public.notas_fiscais enable row level security;
create policy "equipe le notas" on public.notas_fiscais
  for select to authenticated using (true);
