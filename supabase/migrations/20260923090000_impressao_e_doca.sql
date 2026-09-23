-- ZYNTRA — impressão, doca e saída do galpão
--
-- Fecha a Expedição e abre a Logística. Quatro regras:
--
--  1. Não imprime etiqueta sem a conferência concluída. Não existe botão de
--     impressão avulso.
--  2. Comando enviado à impressora não é prova de que saiu papel. A prova é o
--     operador bipar a etiqueta impressa.
--  3. Sair da Expedição é entregar na doca, e quem entrega diz o nome.
--  4. Na saída do galpão, o mesmo pacote bipado duas vezes NÃO soma duas
--     vezes — e essa, sim, é a regra de não contar duas. O valor do Flex é
--     gravado no momento do bipe, não lido depois.

-- ------------------------------------------------------------ impressoras

create table public.impressoras (
  id uuid primary key default gen_random_uuid(),
  estacao_id uuid references public.estacoes (id) on delete set null,
  nome text not null,
  linguagem text not null default 'zpl' check (linguagem in ('zpl', 'pdf')),
  agente_versao text,
  -- O agente local bate aqui de tempos em tempos. Sem batida recente, não há
  -- impressão — e a tela diz isso em vez de fingir que mandou.
  ultimo_contato_em timestamptz,
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.impressoras is
  'Impressora de bancada, alcançada por um agente instalado na máquina. Navegador não fala com Zebra.';

create trigger impressoras_atualizado_em
  before update on public.impressoras
  for each row execute function public.tocar_atualizado_em();

create or replace view public.impressoras_situacao
with (security_invoker = true)
as
select i.*,
       (i.ultimo_contato_em is not null
        and i.ultimo_contato_em > now() - interval '2 minutes') as agente_online
from public.impressoras i;

-- -------------------------------------------------------------- impressões

create type public.documento_tipo as enum
  ('etiqueta', 'danfe', 'lista_separacao', 'minuta');

create table public.impressoes (
  id uuid primary key default gen_random_uuid(),
  tipo public.documento_tipo not null,
  pacote_id uuid references public.pacotes (id) on delete cascade,
  lista_id uuid references public.listas_separacao (id) on delete cascade,
  impressora_id uuid references public.impressoras (id) on delete set null,
  operador_id uuid references public.operadores (id) on delete set null,
  enviada_em timestamptz not null default now(),
  -- REGRA 2: preenchido quando o operador bipa o papel que saiu.
  confirmada_em timestamptz,
  confirmada_codigo text,
  reimpressao boolean not null default false,
  motivo_reimpressao text,
  check (
    (tipo in ('etiqueta', 'danfe') and pacote_id is not null)
    or (tipo = 'lista_separacao' and lista_id is not null)
    or tipo = 'minuta'
  ),
  check (not reimpressao or coalesce(trim(motivo_reimpressao), '') <> '')
);

comment on table public.impressoes is
  'Cada envio de documento à impressora. Enviado não é impresso: `confirmada_em` é que é prova.';

create index impressoes_pacote_idx on public.impressoes (pacote_id);

create or replace function public.solicitar_impressao(
  p_tipo public.documento_tipo,
  p_pacote_id uuid default null,
  p_lista_id uuid default null,
  p_impressora_id uuid default null,
  p_operador_id uuid default null,
  p_motivo_reimpressao text default null
)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ja integer;
  v_reimpressao boolean := false;
begin
  if p_tipo in ('etiqueta', 'danfe') then
    -- REGRA 1: sem conferência concluída, não sai papel.
    if not exists (
      select 1
      from public.conferencias c
      where c.pacote_id = p_pacote_id and c.situacao = 'concluida'
    ) then
      return query select false, 'conferencia_nao_concluida', null::uuid;
      return;
    end if;

    select count(*) into v_ja
    from public.impressoes im
    where im.pacote_id = p_pacote_id and im.tipo = p_tipo;

    v_reimpressao := v_ja > 0;

    if v_reimpressao and coalesce(trim(p_motivo_reimpressao), '') = '' then
      return query select false, 'motivo_reimpressao_obrigatorio', null::uuid;
      return;
    end if;
  end if;

  if p_impressora_id is not null and not exists (
    select 1 from public.impressoras_situacao s
    where s.id = p_impressora_id and s.agente_online
  ) then
    return query select false, 'agente_offline', null::uuid;
    return;
  end if;

  insert into public.impressoes
    (tipo, pacote_id, lista_id, impressora_id, operador_id, reimpressao, motivo_reimpressao)
  values
    (p_tipo, p_pacote_id, p_lista_id, p_impressora_id, p_operador_id,
     v_reimpressao, nullif(trim(coalesce(p_motivo_reimpressao, '')), ''))
  returning id into v_id;

  return query select true, 'ok', v_id;
end;
$$;

comment on function public.solicitar_impressao is
  'Manda o documento para a impressora. Recusa etiqueta sem conferencia concluida, reimpressao sem motivo e agente offline.';

create or replace function public.confirmar_impressao(
  p_impressao_id uuid,
  p_codigo text
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.impressoes im
     set confirmada_em = now(),
         confirmada_codigo = p_codigo
   where im.id = p_impressao_id and im.confirmada_em is null;

  if not found then
    return query select false, 'impressao_nao_encontrada_ou_ja_confirmada';
    return;
  end if;

  return query select true, 'ok';
end;
$$;

comment on function public.confirmar_impressao is
  'O operador bipou o papel que saiu. E a unica prova de impressao fisica que o sistema aceita.';

-- ---------------------------------------------------- entrega na doca

create sequence public.entregas_doca_seq;

create table public.entregas_doca (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default 'ED-' || lpad(nextval('public.entregas_doca_seq')::text, 4, '0'),
  -- REGRA 3: quem está levando. Texto, porque quem leva às vezes não é
  -- operador cadastrado — e mesmo assim o nome tem que ficar.
  entregue_por text not null,
  operador_id uuid references public.operadores (id) on delete set null,
  modalidade_id uuid references public.modalidades (id) on delete set null,
  entregue_em timestamptz not null default now(),
  registrada_por uuid references public.perfis (id) on delete set null
);

comment on table public.entregas_doca is
  'A passagem da Expedição para a Logística. Fica o nome de quem levou, a hora e a relação exata.';

create table public.entregas_doca_pacotes (
  entrega_id uuid not null references public.entregas_doca (id) on delete cascade,
  pacote_id uuid not null references public.pacotes (id) on delete cascade,
  primary key (entrega_id, pacote_id)
);

-- Um pacote é entregue na doca uma vez só.
create unique index pacote_entregue_uma_vez_idx
  on public.entregas_doca_pacotes (pacote_id);

-- ---------------------------------------------------- saída do galpão

create sequence public.saidas_seq;

create table public.saidas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default 'SD-' || lpad(nextval('public.saidas_seq')::text, 4, '0'),
  modalidade_id uuid not null references public.modalidades (id) on delete restrict,
  motorista text,
  situacao text not null default 'em_andamento'
    check (situacao in ('em_andamento', 'fechada', 'cancelada')),
  aberta_por uuid references public.operadores (id) on delete set null,
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz,
  minuta_gerada_em timestamptz
);

comment on table public.saidas is
  'A relação que sai pela porta, por destino. Fechar gera a minuta de despacho.';

create table public.saida_pacotes (
  saida_id uuid not null references public.saidas (id) on delete cascade,
  pacote_id uuid not null references public.pacotes (id) on delete cascade,
  bipado_em timestamptz not null default now(),
  operador_id uuid references public.operadores (id) on delete set null,
  -- O valor do momento, não uma referência. Se o Mercado Livre reajustar a
  -- etiqueta, o mês fechado continua fechado.
  custo_etiqueta numeric(10, 2),
  primary key (saida_id, pacote_id)
);

comment on column public.saida_pacotes.custo_etiqueta is
  'Valor vigente no instante do bipe, congelado. Nulo quando a modalidade nao tem custo.';

-- REGRA 4: o pacote sai do galpão uma vez. Bipar de novo não soma de novo.
create unique index pacote_sai_uma_vez_idx
  on public.saida_pacotes (pacote_id);

create index saida_pacotes_saida_idx on public.saida_pacotes (saida_id);

create or replace function public.bipar_saida(
  p_saida_id uuid,
  p_pacote_id uuid,
  p_operador_id uuid default null
)
returns table (ok boolean, motivo text, custo numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mod uuid;
  v_custo numeric;
  v_outra text;
begin
  if not exists (
    select 1 from public.saidas s
    where s.id = p_saida_id and s.situacao = 'em_andamento'
  ) then
    return query select false, 'saida_nao_aberta', null::numeric;
    return;
  end if;

  if exists (
    select 1 from public.saida_pacotes sp
    where sp.saida_id = p_saida_id and sp.pacote_id = p_pacote_id
  ) then
    -- Já está nesta saída: devolve sem somar de novo.
    return query
      select true, 'ja_bipado',
             (select sp.custo_etiqueta from public.saida_pacotes sp
               where sp.saida_id = p_saida_id and sp.pacote_id = p_pacote_id);
    return;
  end if;

  select s.codigo into v_outra
  from public.saida_pacotes sp
  join public.saidas s on s.id = sp.saida_id
  where sp.pacote_id = p_pacote_id;

  if found then
    return query select false, 'ja_saiu_em_' || v_outra, null::numeric;
    return;
  end if;

  if not exists (
    select 1 from public.pacotes pa
    where pa.id = p_pacote_id and pa.etapa = 'pronto'
  ) then
    return query select false, 'pacote_nao_esta_pronto', null::numeric;
    return;
  end if;

  if not exists (
    select 1 from public.entregas_doca_pacotes ep
    where ep.pacote_id = p_pacote_id
  ) then
    return query select false, 'pacote_nao_entregue_na_doca', null::numeric;
    return;
  end if;

  select e.modalidade_id into v_mod
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  where pa.id = p_pacote_id;

  v_custo := public.custo_etiqueta_em(v_mod, current_date);

  insert into public.saida_pacotes (saida_id, pacote_id, operador_id, custo_etiqueta)
  values (p_saida_id, p_pacote_id, p_operador_id, v_custo);

  return query select true, 'ok', v_custo;
end;
$$;

comment on function public.bipar_saida is
  'Registra que o pacote saiu do galpao e congela o custo da etiqueta. Bipar de novo nao soma de novo.';

create or replace function public.fechar_saida(p_saida_id uuid)
returns table (ok boolean, motivo text, pacotes integer, total numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_total numeric;
begin
  if not exists (
    select 1 from public.saidas s
    where s.id = p_saida_id and s.situacao = 'em_andamento'
  ) then
    return query select false, 'saida_nao_aberta', 0, 0::numeric;
    return;
  end if;

  select count(*), coalesce(sum(sp.custo_etiqueta), 0)
    into v_n, v_total
  from public.saida_pacotes sp
  where sp.saida_id = p_saida_id;

  if v_n = 0 then
    return query select false, 'saida_vazia', 0, 0::numeric;
    return;
  end if;

  update public.saidas s
     set situacao = 'fechada',
         fechada_em = now(),
         minuta_gerada_em = now()
   where s.id = p_saida_id;

  return query select true, 'ok', v_n, v_total;
end;
$$;

-- --------------------------------------------------------------- views

create or replace view public.pacotes_prontos_expedicao
with (security_invoker = true)
as
select pa.*
from public.pacotes pa
where pa.etapa = 'pronto'
  and not exists (
    select 1 from public.entregas_doca_pacotes ep where ep.pacote_id = pa.id
  );

comment on view public.pacotes_prontos_expedicao is
  'A aba Pronto pra envio: conferido e lacrado, ainda nao entregue na doca.';

create or replace view public.pacotes_na_doca
with (security_invoker = true)
as
select pa.*, ed.codigo as entrega_codigo, ed.entregue_por, ed.entregue_em
from public.pacotes pa
join public.entregas_doca_pacotes ep on ep.pacote_id = pa.id
join public.entregas_doca ed on ed.id = ep.entrega_id
where not exists (
  select 1 from public.saida_pacotes sp where sp.pacote_id = pa.id
);

comment on view public.pacotes_na_doca is
  'A aba Doca: entregue pela Expedicao, ainda dentro do galpao.';

create or replace view public.fechamento_custo_etiqueta
with (security_invoker = true)
as
select
  (sp.bipado_em at time zone 'America/Sao_Paulo')::date as dia,
  m.nome as modalidade,
  emp.razao_social as empresa_emissora,
  count(*) as pacotes,
  sum(sp.custo_etiqueta) as total
from public.saida_pacotes sp
join public.pacotes pa on pa.id = sp.pacote_id
join public.envios e on e.id = pa.envio_id
join public.modalidades m on m.id = e.modalidade_id
join public.contas ct on ct.id = pa.conta_id
left join public.empresas emp on emp.id = ct.empresa_emissora_id
where sp.custo_etiqueta is not null
group by 1, 2, 3;

comment on view public.fechamento_custo_etiqueta is
  'O fechamento: soma dos valores congelados no bipe, por dia, modalidade e empresa emissora.';

-- ------------------------------------------------------------------- RLS

alter table public.impressoras enable row level security;
alter table public.impressoes enable row level security;
alter table public.entregas_doca enable row level security;
alter table public.entregas_doca_pacotes enable row level security;
alter table public.saidas enable row level security;
alter table public.saida_pacotes enable row level security;

create policy "equipe lê impressoras" on public.impressoras
  for select to authenticated using (true);
create policy "admin escreve impressoras" on public.impressoras
  for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

create policy "equipe lê impressões" on public.impressoes
  for select to authenticated using (true);
create policy "equipe lê entregas" on public.entregas_doca
  for select to authenticated using (true);
create policy "equipe escreve entregas" on public.entregas_doca
  for all to authenticated
  using (public.papel_atual() in ('operador','lider','admin'))
  with check (public.papel_atual() in ('operador','lider','admin'));
create policy "equipe lê entregas_pacotes" on public.entregas_doca_pacotes
  for select to authenticated using (true);
create policy "equipe escreve entregas_pacotes" on public.entregas_doca_pacotes
  for all to authenticated
  using (public.papel_atual() in ('operador','lider','admin'))
  with check (public.papel_atual() in ('operador','lider','admin'));
create policy "equipe lê saídas" on public.saidas
  for select to authenticated using (true);
create policy "equipe escreve saídas" on public.saidas
  for all to authenticated
  using (public.papel_atual() in ('operador','lider','admin'))
  with check (public.papel_atual() in ('operador','lider','admin'));
create policy "equipe lê saída_pacotes" on public.saida_pacotes
  for select to authenticated using (true);

revoke all on function public.solicitar_impressao(public.documento_tipo, uuid, uuid, uuid, uuid, text) from public, anon;
revoke all on function public.confirmar_impressao(uuid, text) from public, anon;
revoke all on function public.bipar_saida(uuid, uuid, uuid) from public, anon;
revoke all on function public.fechar_saida(uuid) from public, anon;
grant execute on function public.solicitar_impressao(public.documento_tipo, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.confirmar_impressao(uuid, text) to authenticated;
grant execute on function public.bipar_saida(uuid, uuid, uuid) to authenticated;
grant execute on function public.fechar_saida(uuid) to authenticated;
