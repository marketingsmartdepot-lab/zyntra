-- ZYNTRA — fundação
--
-- Empresas (os CNPJs que faturam), pessoas da equipe e papéis.
-- Tudo em português porque o domínio é português: quem lê "separar" e
-- "conferir" na bancada é a mesma pessoa que vai ler o log.

-- ---------------------------------------------------------------- papéis

create type public.papel as enum ('operador', 'lider', 'analista', 'admin');

comment on type public.papel is
  'Operador bipa; líder libera divergência; analista lê; admin configura conta e Faturador.';

-- ------------------------------------------------------------- utilidades

create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- -------------------------------------------------------------- empresas

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  nome_curto text not null,
  cnpj text unique,
  -- Série dedicada ao Faturador do Mercado Livre. Precisa ser diferente da
  -- série que o ERP usa, senão dá rejeição por duplicidade — intermitente,
  -- que é o pior tipo de erro fiscal.
  serie_nfe text,
  faturador_situacao text not null default 'nao_configurado'
    check (faturador_situacao in ('nao_configurado', 'em_teste', 'ativo', 'pausado')),
  faturador_observacao text,
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.empresas is
  'CNPJs que emitem nota. Uma conta de marketplace aponta para uma empresa emissora, que não é necessariamente a dona do estoque.';
comment on column public.empresas.serie_nfe is
  'Série dedicada ao Faturador do ML. Nunca a mesma série do ERP.';

create trigger empresas_atualizado_em
  before update on public.empresas
  for each row execute function public.tocar_atualizado_em();

-- --------------------------------------------------------------- perfis

create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text not null,
  papel public.papel not null default 'operador',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.perfis is
  'Uma linha por pessoa da equipe. Operador de bancada não entra por aqui: entra por estação e PIN.';

create trigger perfis_atualizado_em
  before update on public.perfis
  for each row execute function public.tocar_atualizado_em();

-- Toda conta criada no Auth ganha um perfil. O primeiro a entrar no sistema
-- vira admin — sem isso ninguém consegue configurar nada e o sistema nasce
-- trancado.
create or replace function public.criar_perfil_para_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  primeiro boolean;
begin
  select not exists (select 1 from public.perfis) into primeiro;

  insert into public.perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), split_part(new.email, '@', 1)),
    new.email,
    case when primeiro then 'admin'::public.papel else 'operador'::public.papel end
  );

  return new;
end;
$$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_para_novo_usuario();

-- ------------------------------------------------- leitura de papel no RLS

create or replace function public.papel_atual()
returns public.papel
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.perfis where id = auth.uid() and ativo;
$$;

comment on function public.papel_atual is
  'Papel de quem está na requisição. security definer para não cair em recursão de RLS ao ler perfis.';

create or replace function public.e_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.papel_atual() = 'admin', false);
$$;

-- ------------------------------------------------------------------- RLS

alter table public.empresas enable row level security;
alter table public.perfis enable row level security;

-- Empresas: todo mundo da equipe enxerga; só admin mexe.
create policy "equipe lê empresas"
  on public.empresas for select
  to authenticated
  using (true);

create policy "admin escreve empresas"
  on public.empresas for all
  to authenticated
  using (public.e_admin())
  with check (public.e_admin());

-- Perfis: cada um lê o seu; admin lê e escreve todos.
create policy "cada um lê o próprio perfil"
  on public.perfis for select
  to authenticated
  using (id = auth.uid() or public.e_admin());

create policy "cada um edita o próprio nome"
  on public.perfis for update
  to authenticated
  using (id = auth.uid() or public.e_admin())
  with check (id = auth.uid() or public.e_admin());

create policy "admin cria perfil"
  on public.perfis for insert
  to authenticated
  with check (public.e_admin());

create policy "admin remove perfil"
  on public.perfis for delete
  to authenticated
  using (public.e_admin());
