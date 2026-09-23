-- Configuração de impressora e o agente local.
--
-- A impressora da Smart Depot é a Zebra ZD220: modelo de entrada, 203 dpi,
-- e — o que decide a arquitetura — **só USB**. Sem Ethernet, sem Wi-Fi.
--
-- Consequência: não existe imprimir a partir do servidor. O agente TEM que
-- rodar na máquina fisicamente ligada à impressora. O que o sistema faz é
-- enfileirar o trabalho e saber se aquele agente está vivo.

alter table public.impressoras
  add column if not exists modelo text,
  add column if not exists conexao text not null default 'usb'
    check (conexao in ('usb', 'rede')),
  add column if not exists dpi integer,
  add column if not exists largura_mm integer;

comment on column public.impressoras.conexao is
  'USB obriga o agente a rodar na maquina da bancada. Rede permitiria imprimir do servidor - a ZD220 nao tem.';

-- A fila que o agente consome. `enviada_em` já era o momento em que o pedido
-- foi criado; `situacao` é o que o agente movimenta.
alter table public.impressoes
  add column if not exists situacao text not null default 'pendente'
    check (situacao in ('pendente', 'entregue_ao_agente', 'impressa', 'erro', 'cancelada')),
  add column if not exists entregue_ao_agente_em timestamptz,
  add column if not exists erro text;

create index if not exists impressoes_fila_idx
  on public.impressoes (impressora_id, enviada_em)
  where situacao = 'pendente';

-- ------------------------------------------------------- token do agente
--
-- O agente não tem conta de usuário: ele é uma máquina. Autentica com um
-- token próprio, guardado como hash — o valor em claro aparece uma vez, no
-- momento em que é gerado, e nunca mais.

create table if not exists privado.agentes_impressao (
  impressora_id uuid primary key references public.impressoras (id) on delete cascade,
  token_hash text not null,
  gerado_em timestamptz not null default now(),
  gerado_por uuid references public.perfis (id) on delete set null
);

comment on table privado.agentes_impressao is
  'Token do agente local, como hash. Schema fora do PostgREST.';

create or replace function public.gerar_token_agente(p_impressora_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.e_admin() then
    raise exception 'Só administrador gera token de agente.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.impressoras i where i.id = p_impressora_id) then
    raise exception 'Impressora não encontrada.' using errcode = 'no_data_found';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into privado.agentes_impressao (impressora_id, token_hash, gerado_por)
  values (p_impressora_id, extensions.crypt(v_token, extensions.gen_salt('bf')), auth.uid())
  on conflict (impressora_id) do update
    set token_hash = excluded.token_hash,
        gerado_em = now(),
        gerado_por = excluded.gerado_por;

  -- Devolvido uma vez. Gerar de novo invalida o anterior.
  return v_token;
end;
$$;

comment on function public.gerar_token_agente is
  'Cria o token do agente e devolve em claro UMA vez. Gerar de novo invalida o anterior.';

-- O agente bate ponto. É isso que faz o indicador "agente online" ser
-- verdade em vez de enfeite: sem batida recente, a tela diz que não há
-- impressão em vez de fingir que mandou.
create or replace function public.agente_bater_ponto(
  p_token text,
  p_versao text default null
)
returns table (ok boolean, impressora_id uuid, impressora text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text;
begin
  select a.impressora_id into v_id
  from privado.agentes_impressao a
  where a.token_hash = extensions.crypt(p_token, a.token_hash);

  if v_id is null then
    return query select false, null::uuid, null::text;
    return;
  end if;

  update public.impressoras i
     set ultimo_contato_em = now(),
         agente_versao = coalesce(p_versao, i.agente_versao)
   where i.id = v_id
  returning i.nome into v_nome;

  return query select true, v_id, v_nome;
end;
$$;

comment on function public.agente_bater_ponto is
  'Batida do agente local. Chamavel sem sessao: o agente e maquina, autentica pelo token.';

-- O agente precisa chamar sem sessão de usuário.
revoke all on function public.agente_bater_ponto(text, text) from public;
grant execute on function public.agente_bater_ponto(text, text) to anon, authenticated;

revoke all on function public.gerar_token_agente(uuid) from public, anon;
grant execute on function public.gerar_token_agente(uuid) to authenticated;

-- -------------------------------------------------------------- a view

drop view if exists public.impressoras_situacao;

create view public.impressoras_situacao
with (security_invoker = true)
as
select
  i.id,
  i.nome,
  i.modelo,
  i.conexao,
  i.linguagem,
  i.dpi,
  i.largura_mm,
  i.ativa,
  i.agente_versao,
  i.ultimo_contato_em,
  e.id   as estacao_id,
  e.nome as estacao,
  (i.ultimo_contato_em is not null
   and i.ultimo_contato_em > now() - interval '2 minutes') as agente_online,
  (select count(*) from privado.agentes_impressao a where a.impressora_id = i.id) > 0
    as token_gerado,
  (select count(*)::integer from public.impressoes im
    where im.impressora_id = i.id and im.situacao = 'pendente') as na_fila,
  (select max(im.enviada_em) from public.impressoes im
    where im.impressora_id = i.id) as ultimo_trabalho_em
from public.impressoras i
left join public.estacoes e on e.id = i.estacao_id;

comment on view public.impressoras_situacao is
  'O que a aba de impressoras mostra: se o agente esta vivo, se ja tem token e quanto esta na fila.';
