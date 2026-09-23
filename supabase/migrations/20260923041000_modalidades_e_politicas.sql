-- ZYNTRA — modalidades de envio e suas políticas
--
-- Regra por modalidade vira LINHA, não `if` no código. É o que impede o
-- problema do Full — pedido cujo estoque está no galpão do Mercado Livre
-- aparecendo na lista de separação — e o que absorve modalidade nova sem
-- refatorar nada.
--
-- Os slugs abaixo são o `logistic_type` do Mercado Livre. NÃO consegui
-- confirmar essa lista na documentação (o portal do ML devolve 403 para
-- leitura automatizada), então ela é um ponto de partida: a checagem de
-- verdade é a primeira sincronização com token real.
--
-- Por isso a tabela é tolerante: modalidade que chegar e não estiver aqui é
-- criada sozinha como NÃO CLASSIFICADA e não entra na esteira. Errar para o
-- lado de não separar é barato; errar para o lado de separar o que não devia
-- custa caixa errada na rua.

create table public.modalidades (
  id uuid primary key default gen_random_uuid(),
  canal_id uuid not null references public.canais (id) on delete cascade,
  slug text not null,
  nome text not null,

  -- Entra na esteira do galpão?
  entra_na_esteira boolean not null default false,
  -- A nota autorizada é pré-requisito para separar?
  exige_nota_antes boolean not null default true,
  -- O canal gera etiqueta? "A combinar" não gera: o envio é acertado com o
  -- comprador, então ficar contando tempo de espera por etiqueta é ruído.
  gera_etiqueta boolean not null default true,
  -- Tem janela de coleta fixa, ou a saída é contínua?
  tem_janela_coleta boolean not null default false,

  classificada boolean not null default true,
  observacao text,

  criada_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (canal_id, slug)
);

comment on table public.modalidades is
  'Uma linha por logistic_type. Modalidade desconhecida nasce não classificada e fora da esteira, de propósito.';

create trigger modalidades_atualizado_em
  before update on public.modalidades
  for each row execute function public.tocar_atualizado_em();

insert into public.modalidades
  (canal_id, slug, nome, entra_na_esteira, gera_etiqueta, tem_janela_coleta, observacao)
select c.id, m.slug, m.nome, m.entra, m.etiqueta, m.janela, m.obs
from public.canais c
cross join (values
  ('self_service',  'Flex',        true,  true,  false,
   'Saída contínua, motorista sob demanda. É a única modalidade com custo de etiqueta.'),
  ('cross_docking', 'Coleta',      true,  true,  true,
   'Coleta do Mercado Livre no galpão, com janela fixa.'),
  ('drop_off',      'Agência',     true,  true,  true,
   'Levado pelo time até o ponto de coleta.'),
  ('xd_drop_off',   'Agência XD',  true,  true,  true,
   'Variante de drop off com cross docking.'),
  ('fulfillment',   'Full',        false, true,  false,
   'A mercadoria está no galpão do ML. Nunca entra na esteira.'),
  ('custom',        'A combinar',  true,  false, false,
   'Envio acertado com o comprador. Não gera etiqueta do ML, então não espera por uma.')
) as m(slug, nome, entra, etiqueta, janela, obs)
where c.slug = 'mercado_livre';

-- ------------------------------------------------------- custo de etiqueta
--
-- O valor tem vigência porque ele muda. Gravar só "11,99" numa coluna faria
-- o fechamento do mês passado mudar sozinho quando o Mercado Livre
-- reajustasse — e um número que muda depois de fechado não serve para nada.

create table public.custos_etiqueta (
  id uuid primary key default gen_random_uuid(),
  modalidade_id uuid not null references public.modalidades (id) on delete cascade,
  valor numeric(10, 2) not null check (valor >= 0),
  vigente_de date not null,
  vigente_ate date,
  criado_em timestamptz not null default now(),
  check (vigente_ate is null or vigente_ate >= vigente_de)
);

comment on table public.custos_etiqueta is
  'Custo por pacote despachado, por modalidade e com vigência. Hoje só o Flex tem: coleta e agência não somam nada.';

create index custos_etiqueta_vigencia_idx
  on public.custos_etiqueta (modalidade_id, vigente_de desc);

-- Só o Flex tem custo. As outras modalidades não recebem linha nenhuma —
-- ausência de linha é ausência de custo, que é mais honesto que um zero.
insert into public.custos_etiqueta (modalidade_id, valor, vigente_de)
select m.id, 11.99, date '2026-07-01'
from public.modalidades m
join public.canais c on c.id = m.canal_id
where c.slug = 'mercado_livre' and m.slug = 'self_service';

create or replace function public.custo_etiqueta_em(
  p_modalidade_id uuid,
  p_data date default current_date
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select ce.valor
  from public.custos_etiqueta ce
  where ce.modalidade_id = p_modalidade_id
    and ce.vigente_de <= p_data
    and (ce.vigente_ate is null or ce.vigente_ate >= p_data)
  order by ce.vigente_de desc
  limit 1;
$$;

comment on function public.custo_etiqueta_em is
  'Valor vigente naquela data. Quem bipa grava o retorno, não a referência — senão o mês fechado muda quando a tabela muda.';

-- ------------------------------------------------------------------- RLS

alter table public.modalidades enable row level security;
alter table public.custos_etiqueta enable row level security;

create policy "equipe lê modalidades"
  on public.modalidades for select to authenticated using (true);
create policy "admin escreve modalidades"
  on public.modalidades for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

create policy "equipe lê custos"
  on public.custos_etiqueta for select to authenticated using (true);
create policy "admin escreve custos"
  on public.custos_etiqueta for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

revoke all on function public.custo_etiqueta_em(uuid, date) from public, anon;
grant execute on function public.custo_etiqueta_em(uuid, date) to authenticated;
