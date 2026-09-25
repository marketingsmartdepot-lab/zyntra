-- Só quem a Daniele cadastrar usa o sistema.
--
-- O ZYNTRA foi para o ar numa URL pública e o levantamento achou três buracos,
-- do mais grave para o menos:
--
-- 1. QUALQUER pessoa logada podia virar admin sozinha. A política de perfis
--    deixava a pessoa editar o próprio perfil, e `authenticated` tinha UPDATE
--    na tabela inteira — inclusive nas colunas `papel` e `ativo`. Um
--    `update perfis set papel='admin' where id = auth.uid()` bastava.
--
-- 2. 35 tabelas liberavam leitura com `using (true)`. Isso é "qualquer
--    requisição autenticada", não "a equipe": pedidos com nome e endereço de
--    comprador, notas, custos, contas — tudo. E, pior, significava que
--    desativar uma pessoa não tirava nada dela: nenhuma política de leitura
--    olhava para `ativo`.
--
-- 3. Todo usuário novo do Auth nascia com perfil `operador` e `ativo = true`.
--    Com o cadastro público do Supabase ligado, um estranho que achasse a URL
--    entrava como operador do galpão.
--
-- Esta migração fecha os três no banco. O quarto passo — desligar o cadastro
-- público no painel do Supabase Auth — é configuração do serviço, não do
-- banco, e fica para ela. Mesmo sem esse passo, quem se cadastrar sozinho
-- agora cai num perfil inativo que não enxerga nada.

-- ------------------------------------------------- quem é "a equipe"

create or replace function public.e_da_equipe()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfis where id = auth.uid() and ativo
  );
$$;

comment on function public.e_da_equipe is
  'Pessoa logada COM perfil ativo. E a condicao de leitura de tudo: desativar alguem passa a tirar o acesso na hora, em todas as tabelas.';

revoke all on function public.e_da_equipe() from public, anon;
grant execute on function public.e_da_equipe() to authenticated;

-- ---------------------------------- fecha as 35 leituras abertas de uma vez

-- Reescrito em laço de propósito: são 35 políticas e a lista é lida do
-- catálogo, não digitada. Uma lista digitada erra uma tabela e ninguém vê.
--
-- O `(select ...)` não é enfeite: sem ele o Postgres chama a função uma vez
-- POR LINHA. Dentro de um select, ele vira InitPlan e roda uma vez só.
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public' and cmd = 'SELECT' and qual::text = 'true'
  loop
    execute format(
      'alter policy %I on public.%I using ((select public.e_da_equipe()))',
      r.policyname, r.tablename
    );
    n := n + 1;
  end loop;

  raise notice 'politicas de leitura fechadas: %', n;
end $$;

-- ------------------------------------- ninguém se promove a admin sozinho

-- A lição já aprendida neste projeto: revogar coluna não adianta enquanto o
-- GRANT de tabela existe. Revoga a tabela e concede coluna a coluna.
revoke all on table public.perfis from anon, authenticated;

grant select on table public.perfis to authenticated;
-- A única coisa que a pessoa muda no próprio perfil é como ela se chama.
grant update (nome) on table public.perfis to authenticated;

comment on column public.perfis.papel is
  'So muda por definir_papel_perfil, que exige admin. `authenticated` nao tem UPDATE nesta coluna.';
comment on column public.perfis.ativo is
  'So muda por definir_situacao_perfil, que exige admin. Desativar tira o acesso a tudo na hora, via e_da_equipe().';

-- ------------------------------------------- a lista de quem pode entrar

create table if not exists public.equipe_autorizada (
  email text primary key,
  papel public.papel not null default 'operador',
  nome text,
  autorizada_por uuid references public.perfis (id) on delete set null,
  criada_em timestamptz not null default now(),
  usada_em timestamptz
);

comment on table public.equipe_autorizada is
  'Os e-mails que a administracao liberou. Quem nao esta aqui pode ate criar login, mas nasce inativo e nao enxerga nada.';
comment on column public.equipe_autorizada.usada_em is
  'Quando a pessoa efetivamente criou o login. Nulo = convite ainda nao usado.';

-- E-mail é comparado com o do Auth, que chega em minúsculas. Guardar
-- "Joao@Empresa.com" faria o convite nunca casar, silenciosamente.
create or replace function public.normalizar_email_autorizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.nome := nullif(btrim(coalesce(new.nome, '')), '');
  return new;
end;
$$;

drop trigger if exists equipe_autorizada_normaliza on public.equipe_autorizada;
create trigger equipe_autorizada_normaliza
  before insert or update on public.equipe_autorizada
  for each row execute function public.normalizar_email_autorizado();

alter table public.equipe_autorizada enable row level security;

drop policy if exists "admin le equipe autorizada" on public.equipe_autorizada;
create policy "admin le equipe autorizada" on public.equipe_autorizada
  for select to authenticated using (public.e_admin());

revoke all on table public.equipe_autorizada from anon, authenticated;
grant select on table public.equipe_autorizada to authenticated;

-- ------------------------------------- o perfil novo nasce conforme a lista

create or replace function public.criar_perfil_para_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primeiro boolean;
  convite public.equipe_autorizada%rowtype;
begin
  select not exists (select 1 from public.perfis) into primeiro;

  select * into convite
  from public.equipe_autorizada
  where email = lower(btrim(new.email));

  insert into public.perfis (id, nome, email, papel, ativo)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'nome'), ''),
      convite.nome,
      split_part(new.email, '@', 1)
    ),
    new.email,
    case
      when primeiro then 'admin'::public.papel
      when convite.email is not null then convite.papel
      else 'operador'::public.papel
    end,
    -- O ponto da mudança: ativo só para quem foi convidado (ou para o
    -- primeiro perfil do sistema, que é quem monta tudo).
    primeiro or convite.email is not null
  );

  if convite.email is not null then
    update public.equipe_autorizada
       set usada_em = now()
     where email = convite.email;
  end if;

  return new;
end;
$$;

comment on function public.criar_perfil_para_novo_usuario is
  'Perfil novo so nasce ativo se o e-mail estava na equipe_autorizada. Estranho que se cadastra sozinho fica inativo e nao le nada.';

-- --------------------------------------------- as ações da administração

create or replace function public.autorizar_pessoa(
  p_email text,
  p_papel public.papel default 'operador',
  p_nome text default null
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.e_admin() then
    return query select false, 'so_admin';
    return;
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    return query select false, 'email_invalido';
    return;
  end if;

  -- Se a pessoa já tem login, autorizar é ligar o perfil dela — não adianta
  -- só pôr na lista, porque a lista é lida na criação do login.
  update public.perfis
     set ativo = true, papel = p_papel
   where email = v_email;

  insert into public.equipe_autorizada (email, papel, nome, autorizada_por)
  values (v_email, p_papel, p_nome, auth.uid())
  on conflict (email) do update
    set papel = excluded.papel,
        nome = coalesce(excluded.nome, public.equipe_autorizada.nome),
        autorizada_por = excluded.autorizada_por;

  return query select true, 'ok';
end;
$$;

comment on function public.autorizar_pessoa is
  'Libera um e-mail. Se a pessoa ja tem login, liga o perfil no mesmo ato — senao autorizar alguem que ja tentou entrar nao faria nada.';

create or replace function public.revogar_pessoa(p_email text)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_admins integer;
begin
  if not public.e_admin() then
    return query select false, 'so_admin';
    return;
  end if;

  select id into v_id from public.perfis where email = v_email;

  if v_id is not null then
    -- Não dá para desligar o último admin ativo: ninguém religaria ninguém,
    -- e o sistema ficaria sem dono.
    select count(*) into v_admins
      from public.perfis where papel = 'admin' and ativo and id <> v_id;

    if exists (select 1 from public.perfis where id = v_id and papel = 'admin' and ativo)
       and v_admins = 0 then
      return query select false, 'ultimo_admin';
      return;
    end if;

    update public.perfis set ativo = false where id = v_id;
  end if;

  delete from public.equipe_autorizada where email = v_email;

  return query select true, 'ok';
end;
$$;

comment on function public.revogar_pessoa is
  'Tira o acesso na hora e apaga o convite. Recusa desligar o ultimo admin ativo.';

create or replace function public.definir_papel_perfil(
  p_perfil_id uuid,
  p_papel public.papel
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admins integer;
begin
  if not public.e_admin() then
    return query select false, 'so_admin';
    return;
  end if;

  if p_papel <> 'admin'
     and exists (select 1 from public.perfis
                  where id = p_perfil_id and papel = 'admin' and ativo) then
    select count(*) into v_admins
      from public.perfis
     where papel = 'admin' and ativo and id <> p_perfil_id;

    if v_admins = 0 then
      return query select false, 'ultimo_admin';
      return;
    end if;
  end if;

  update public.perfis set papel = p_papel where id = p_perfil_id;

  if not found then
    return query select false, 'perfil_nao_encontrado';
    return;
  end if;

  update public.equipe_autorizada e
     set papel = p_papel
    from public.perfis pe
   where pe.id = p_perfil_id and e.email = pe.email;

  return query select true, 'ok';
end;
$$;

comment on function public.definir_papel_perfil is
  'Troca o papel. Recusa rebaixar o ultimo admin ativo.';

revoke all on function public.autorizar_pessoa(text, public.papel, text) from public, anon;
revoke all on function public.revogar_pessoa(text) from public, anon;
revoke all on function public.definir_papel_perfil(uuid, public.papel) from public, anon;

grant execute on function public.autorizar_pessoa(text, public.papel, text) to authenticated;
grant execute on function public.revogar_pessoa(text) to authenticated;
grant execute on function public.definir_papel_perfil(uuid, public.papel) to authenticated;

-- --------------------------------------------- a lista para a tela ler

create or replace view public.equipe_resumo
with (security_invoker = true)
as
select
  p.id,
  p.nome,
  p.email,
  p.papel::text as papel,
  p.ativo,
  p.criado_em,
  (a.email is not null) as autorizada,
  a.criada_em as autorizada_em
from public.perfis p
left join public.equipe_autorizada a on a.email = p.email;

comment on view public.equipe_resumo is
  'Quem tem login no ZYNTRA e em que situacao. security_invoker: so admin le, porque a politica de perfis so deixa admin ver os outros.';
