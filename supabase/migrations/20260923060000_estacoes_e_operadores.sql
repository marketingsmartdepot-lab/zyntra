-- ZYNTRA — estações da bancada e operadores por PIN
--
-- A segunda porta da entrada. O desenho é este:
--
-- A ESTAÇÃO tem conta própria no Auth e fica conectada o dia inteiro. O
-- OPERADOR não tem conta: ele entra com quatro dígitos, e o PIN não dá acesso
-- ao banco — ele define AUTORIA.
--
-- Isso existe porque numa bancada compartilhada dar conta completa a cada
-- operador significa que um deles fica logado e o turno inteiro sai no nome
-- dele. Com PIN, a autoria muda a cada troca, que é o que faz a auditoria
-- valer alguma coisa quando aparece uma caixa errada.

create extension if not exists pgcrypto with schema extensions;

-- -------------------------------------------------------------- estações

create table public.estacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  local text,
  -- Conta do Auth que essa estação usa para ficar conectada.
  perfil_id uuid references public.perfis (id) on delete set null,
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.estacoes is
  'Bancadas do galpão. Cada uma tem conta própria e fica conectada; quem troca é o operador.';

create trigger estacoes_atualizado_em
  before update on public.estacoes
  for each row execute function public.tocar_atualizado_em();

-- ------------------------------------------------------------ operadores

create table public.operadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  -- Nunca o PIN em texto. Hash com bcrypt.
  pin_hash text,
  papel public.papel not null default 'operador'
    check (papel in ('operador', 'lider')),
  -- Quatro dígitos são poucos, então tentativa errada custa: depois de 5
  -- seguidas o operador fica travado por um tempo. Sem isso, adivinhar PIN
  -- na bancada é questão de paciência.
  tentativas_falhas integer not null default 0,
  bloqueado_ate timestamptz,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.operadores is
  'Quem trabalha de pé. Não tem conta no Auth: o PIN define autoria, não acesso.';
comment on column public.operadores.bloqueado_ate is
  'Trava temporária depois de PIN errado seguido. Quatro dígitos precisam disso.';

create trigger operadores_atualizado_em
  before update on public.operadores
  for each row execute function public.tocar_atualizado_em();

-- --------------------------------------------------------------- sessões

create table public.sessoes_estacao (
  id uuid primary key default gen_random_uuid(),
  estacao_id uuid not null references public.estacoes (id) on delete cascade,
  operador_id uuid not null references public.operadores (id) on delete restrict,
  iniciada_em timestamptz not null default now(),
  encerrada_em timestamptz
);

comment on table public.sessoes_estacao is
  'Quem está na bancada agora, e quem esteve. Cada bipe se pendura na sessão aberta.';

-- Uma estação só tem um operador por vez.
create unique index sessao_aberta_por_estacao_idx
  on public.sessoes_estacao (estacao_id) where encerrada_em is null;

create index sessoes_estacao_idx
  on public.sessoes_estacao (estacao_id, iniciada_em desc);

-- ------------------------------------------------------------ definir PIN

create or replace function public.definir_pin_operador(
  p_operador_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.papel_atual() in ('lider', 'admin')) then
    raise exception 'Só líder ou administrador define PIN.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'O PIN precisa ter de 4 a 8 dígitos.'
      using errcode = 'check_violation';
  end if;

  update public.operadores
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         tentativas_falhas = 0,
         bloqueado_ate = null
   where id = p_operador_id;

  if not found then
    raise exception 'Operador não encontrado.' using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.definir_pin_operador is
  'Guarda o PIN como hash. O valor em texto não fica em lugar nenhum.';

-- ------------------------------------------------------- abrir uma sessão

create or replace function public.abrir_sessao_estacao(
  p_estacao_id uuid,
  p_operador_id uuid,
  p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.operadores%rowtype;
  v_sessao uuid;
begin
  select * into v_op from public.operadores where id = p_operador_id;

  if not found or not v_op.ativo then
    raise exception 'Operador não encontrado ou inativo.'
      using errcode = 'no_data_found';
  end if;

  if v_op.bloqueado_ate is not null and v_op.bloqueado_ate > now() then
    raise exception 'PIN bloqueado até %. Chame o líder.', v_op.bloqueado_ate
      using errcode = 'insufficient_privilege';
  end if;

  if v_op.pin_hash is null
     or extensions.crypt(p_pin, v_op.pin_hash) <> v_op.pin_hash then
    update public.operadores
       set tentativas_falhas = tentativas_falhas + 1,
           bloqueado_ate = case
             when tentativas_falhas + 1 >= 5 then now() + interval '10 minutes'
             else bloqueado_ate
           end
     where id = p_operador_id;

    raise exception 'PIN incorreto.' using errcode = 'invalid_password';
  end if;

  update public.operadores
     set tentativas_falhas = 0, bloqueado_ate = null
   where id = p_operador_id;

  -- Trocar de operador encerra a sessão de quem estava.
  update public.sessoes_estacao
     set encerrada_em = now()
   where estacao_id = p_estacao_id and encerrada_em is null;

  insert into public.sessoes_estacao (estacao_id, operador_id)
  values (p_estacao_id, p_operador_id)
  returning id into v_sessao;

  return v_sessao;
end;
$$;

comment on function public.abrir_sessao_estacao is
  'Troca o operador da bancada. Encerra a sessão anterior: duas pessoas não bipam ao mesmo tempo na mesma estação.';

create or replace function public.encerrar_sessao_estacao(p_estacao_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sessoes_estacao
     set encerrada_em = now()
   where estacao_id = p_estacao_id and encerrada_em is null;
$$;

-- ------------------------------------------------------------------- RLS

alter table public.estacoes enable row level security;
alter table public.operadores enable row level security;
alter table public.sessoes_estacao enable row level security;

create policy "equipe lê estações" on public.estacoes
  for select to authenticated using (true);
create policy "admin escreve estações" on public.estacoes
  for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

-- O hash do PIN não sai daqui em nenhuma leitura de tabela: a coluna existe,
-- mas quem lê a tabela só precisa de nome e papel. A view abaixo é o que a
-- tela usa.
create policy "equipe lê operadores" on public.operadores
  for select to authenticated using (true);
create policy "líder e admin escrevem operadores" on public.operadores
  for all to authenticated
  using (public.papel_atual() in ('lider', 'admin'))
  with check (public.papel_atual() in ('lider', 'admin'));

create policy "equipe lê sessões" on public.sessoes_estacao
  for select to authenticated using (true);

revoke all on function public.definir_pin_operador(uuid, text) from public, anon;
revoke all on function public.abrir_sessao_estacao(uuid, uuid, text) from public, anon;
revoke all on function public.encerrar_sessao_estacao(uuid) from public, anon;
grant execute on function public.definir_pin_operador(uuid, text) to authenticated;
grant execute on function public.abrir_sessao_estacao(uuid, uuid, text) to authenticated;
grant execute on function public.encerrar_sessao_estacao(uuid) to authenticated;

-- O hash nunca precisa trafegar. A tela da estação lê daqui.
create or replace view public.operadores_da_bancada
with (security_invoker = true)
as
select id, nome, papel, ativo,
       (bloqueado_ate is not null and bloqueado_ate > now()) as bloqueado
from public.operadores
where ativo;

comment on view public.operadores_da_bancada is
  'O que a tela da estação mostra. Sem hash de PIN.';
