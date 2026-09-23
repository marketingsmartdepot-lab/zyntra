-- ZYNTRA — pedidos, envios e a esteira
--
-- A decisão que organiza tudo: a unidade de trabalho é o ENVIO, não o pedido.
-- Um carrinho de três vendas é um pacote, uma etiqueta e uma caixa. Se a
-- unidade fosse o pedido, o operador veria três cartões para uma caixa só, e
-- bipar a etiqueta seria ambíguo.

-- ---------------------------------------------------------------- envios

create table public.envios (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  modalidade_id uuid references public.modalidades (id) on delete restrict,

  ref_externa text not null,

  situacao_canal text,
  substatus_canal text,

  -- Prazo que o próprio canal informa. Nunca calculado por nós.
  limite_envio_em timestamptz,
  limite_origem text,

  -- Obter a etiqueta e imprimir a etiqueta são momentos diferentes: a primeira
  -- acontece ainda em Faturado, a segunda só depois da bipagem fechar.
  etiqueta_obtida_em timestamptz,
  -- Carimbo do próprio canal. Se ele chegar sem existir conferência nossa,
  -- alguém imprimiu por fora — e isso vira ocorrência.
  impresso_no_canal_em timestamptz,
  despachado_em timestamptz,

  volumes integer not null default 1 check (volumes > 0),

  bruto jsonb,
  sincronizado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (conta_id, ref_externa)
);

comment on table public.envios is
  'Um envio do canal. É a unidade física: uma etiqueta, uma caixa.';
comment on column public.envios.impresso_no_canal_em is
  'Carimbo de impressão vindo do canal. Sem conferência nossa correspondente, significa impressão fora do sistema.';

create index envios_conta_idx on public.envios (conta_id);
create index envios_limite_idx on public.envios (limite_envio_em);

create trigger envios_atualizado_em
  before update on public.envios
  for each row execute function public.tocar_atualizado_em();

-- --------------------------------------------------------------- pedidos

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  -- N pedidos para 1 envio: é assim que o carrinho entra no modelo.
  envio_id uuid references public.envios (id) on delete set null,

  ref_externa text not null,
  pack_ref text,

  situacao_canal text,
  comprador text,

  pago_em timestamptz,
  criado_no_canal_em timestamptz,
  atualizado_no_canal_em timestamptz,
  cancelado_em timestamptz,

  total numeric(12, 2),
  unidades integer not null default 0,

  bruto jsonb,
  sincronizado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (conta_id, ref_externa)
);

comment on column public.pedidos.pack_ref is
  'Identificador do carrinho. Vários pedidos com o mesmo pack viram um envio só — e uma chave de idempotência fiscal só.';

create index pedidos_envio_idx on public.pedidos (envio_id);
create index pedidos_pack_idx on public.pedidos (conta_id, pack_ref) where pack_ref is not null;

create trigger pedidos_atualizado_em
  before update on public.pedidos
  for each row execute function public.tocar_atualizado_em();

create table public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  ref_anuncio text,
  ref_variacao text,
  -- O SKU como o canal mandou. Texto livre, frequentemente vazio ou divergente
  -- do ERP: casar isso com o catálogo é problema à parte, e é o que decide se
  -- a conferência consegue validar alguma coisa.
  sku_informado text,
  titulo text,
  foto_url text,
  quantidade integer not null check (quantidade > 0),
  preco_unitario numeric(12, 2),
  criado_em timestamptz not null default now()
);

create index pedido_itens_pedido_idx on public.pedido_itens (pedido_id);

-- --------------------------------------------------------------- unidades

create type public.etapa as enum (
  'aberto',     -- pago e elegível, mas travado no faturamento ou no SKU
  'faturado',   -- nota autorizada, esperando a etiqueta do canal
  'separar',    -- nota e etiqueta prontas; sai daqui para uma lista
  'conferir',   -- separado, esperando a bipagem na bancada
  'pronto',     -- conferido, lacrado, esperando a doca
  'retido',     -- fora da esteira: problema externo
  'encerrado'   -- entregue à doca, ou cancelado e resolvido
);

create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  envio_id uuid not null unique references public.envios (id) on delete cascade,
  conta_id uuid not null references public.contas (id) on delete cascade,

  etapa public.etapa not null default 'aberto',
  etapa_desde timestamptz not null default now(),
  -- Guardado ao entrar em Retido, para o pedido voltar de onde saiu.
  etapa_anterior public.etapa,

  -- Quantidade esperada na caixa, já expandida por kit. Fica nulo até o
  -- catálogo existir: sem composição de kit não dá para saber que uma venda
  -- de "pack de 3" são três unidades.
  unidades_esperadas integer,

  criada_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.unidades is
  'A unidade da esteira: uma por envio. Cada uma está em exatamente uma etapa — nunca em duas abas ao mesmo tempo.';

create index unidades_etapa_idx on public.unidades (etapa);
create index unidades_conta_idx on public.unidades (conta_id);

create trigger unidades_atualizado_em
  before update on public.unidades
  for each row execute function public.tocar_atualizado_em();

-- ------------------------------------------------------------- bloqueios
--
-- Exceção é bloqueio no pedido, não etapa paralela. O que muda de etapa é o
-- Retido, e só para problema externo.

create type public.bloqueio_tipo as enum (
  'sem_nota',
  'rejeicao_fiscal',
  'faturador_nao_configurado',
  'sku_nao_mapeado',
  'sem_etiqueta',
  'sem_estoque',
  'pedido_alterado',
  'impressao_fora_do_sistema'
);

create table public.bloqueios (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.unidades (id) on delete cascade,
  tipo public.bloqueio_tipo not null,
  -- Chave de agrupamento: é o que faz a aba Aberto juntar por CAUSA em vez de
  -- por pedido. Corrigir um NCM uma vez libera os trinta pedidos juntos.
  causa text,
  codigo text,
  detalhe text,
  aberto_em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por uuid references public.perfis (id) on delete set null
);

create index bloqueios_abertos_idx
  on public.bloqueios (unidade_id) where resolvido_em is null;
create index bloqueios_causa_idx
  on public.bloqueios (tipo, causa) where resolvido_em is null;

-- --------------------------------------------------------------- eventos

create table public.eventos_unidade (
  id bigint generated always as identity primary key,
  unidade_id uuid not null references public.unidades (id) on delete cascade,
  tipo text not null,
  de text,
  para text,
  detalhe text,
  por uuid references public.perfis (id) on delete set null,
  em timestamptz not null default now()
);

comment on table public.eventos_unidade is
  'Linha do tempo do pedido: a aba Histórico sai daqui.';

create index eventos_unidade_idx on public.eventos_unidade (unidade_id, em desc);

-- ------------------------------------------------- máquina de etapas
--
-- As transições vivem no banco porque a esteira é a regra do negócio, não
-- detalhe de tela. Um bug de rota não pode conseguir pular a conferência.

create or replace function public.validar_transicao_etapa()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  permitido boolean := false;
begin
  if new.etapa = old.etapa then
    return new;
  end if;

  -- Encerrar e reter são possíveis de qualquer lugar.
  if new.etapa in ('encerrado', 'retido') then
    permitido := true;

  elsif old.etapa = 'retido' then
    -- Sai do Retido só voltando para onde estava.
    permitido := new.etapa = old.etapa_anterior;

  else
    permitido := (old.etapa, new.etapa) in (
      ('aberto',   'faturado'),
      ('faturado', 'separar'),
      ('faturado', 'aberto'),    -- nota cancelada devolve o pedido
      ('separar',  'conferir'),
      ('separar',  'faturado'),  -- lista desfeita
      ('conferir', 'pronto'),
      ('conferir', 'separar')    -- devolvido para nova separação
    );
  end if;

  if not permitido then
    raise exception
      'Transicao de etapa invalida: % -> % (unidade %)',
      old.etapa, new.etapa, old.id
      using errcode = 'check_violation';
  end if;

  if new.etapa = 'retido' and old.etapa <> 'retido' then
    new.etapa_anterior := old.etapa;
  elsif old.etapa = 'retido' then
    new.etapa_anterior := null;
  end if;

  new.etapa_desde := now();

  insert into public.eventos_unidade (unidade_id, tipo, de, para, por)
  values (old.id, 'etapa', old.etapa::text, new.etapa::text, auth.uid());

  return new;
end;
$$;

create trigger unidades_transicao
  before update of etapa on public.unidades
  for each row execute function public.validar_transicao_etapa();

-- ------------------------------------------------------------------- RLS

alter table public.envios enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_itens enable row level security;
alter table public.unidades enable row level security;
alter table public.bloqueios enable row level security;
alter table public.eventos_unidade enable row level security;

-- A equipe inteira lê a operação; escrever na esteira é do lado servidor
-- (sincronização e ações), que usa a chave de serviço e passa por cima do RLS.
create policy "equipe lê envios" on public.envios
  for select to authenticated using (true);
create policy "equipe lê pedidos" on public.pedidos
  for select to authenticated using (true);
create policy "equipe lê itens" on public.pedido_itens
  for select to authenticated using (true);
create policy "equipe lê unidades" on public.unidades
  for select to authenticated using (true);
create policy "equipe lê bloqueios" on public.bloqueios
  for select to authenticated using (true);
create policy "equipe lê eventos" on public.eventos_unidade
  for select to authenticated using (true);
