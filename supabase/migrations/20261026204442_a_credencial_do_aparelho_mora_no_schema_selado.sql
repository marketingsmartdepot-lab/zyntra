-- A sessao que o PIN abre e de um perfil dedicado — a "conta do aparelho".
-- Alguem precisa guardar a credencial dela, e esse alguem nao pode ser o
-- navegador: quem abrisse o inspetor teria a senha de uma conta que entra no
-- sistema.
--
-- Ela mora em `privado.config`, o mesmo lugar do segredo interno e da URL das
-- functions. O schema `privado` e SELADO: nenhum papel tem grant nas tabelas
-- dele, nem o service_role. A unica ponte sao funcoes `security definer` em
-- `public` com grant explicito — e estas so para `service_role`.
--
-- A senha nunca e digitada por ninguem: a Edge Function sorteia na primeira
-- vez, cria a conta e guarda aqui.

create or replace function public.conta_do_aparelho()
returns table (email text, senha text)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    (select c.valor from privado.config c where c.chave = 'aparelho_email'),
    (select c.valor from privado.config c where c.chave = 'aparelho_senha');
$function$;

comment on function public.conta_do_aparelho is
  'A credencial da conta que o PIN usa para abrir sessao. Ponte para o schema '
  'selado; so o service_role chama, nunca o navegador.';

create or replace function public.gravar_conta_do_aparelho(
  p_email text, p_senha text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into privado.config (chave, valor)
  values ('aparelho_email', p_email)
  on conflict (chave) do update set valor = excluded.valor;

  insert into privado.config (chave, valor)
  values ('aparelho_senha', p_senha)
  on conflict (chave) do update set valor = excluded.valor;
end;
$function$;

revoke all on function public.conta_do_aparelho() from public, anon, authenticated;
revoke all on function public.gravar_conta_do_aparelho(text, text)
  from public, anon, authenticated;

grant execute on function public.conta_do_aparelho() to service_role;
grant execute on function public.gravar_conta_do_aparelho(text, text) to service_role;
