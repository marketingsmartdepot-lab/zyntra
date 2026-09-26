-- O que o OAuth do Mercado Livre precisa e o do Bling não tinha.
--
-- Três diferenças que governam o desenho:
--   1. O ML exige `redirect_uri` no pedido E na troca, e ele tem de bater
--      EXATAMENTE com o cadastrado no aplicativo. Então fica guardado, não
--      montado na hora — origem diferente entre produção e máquina local
--      faria a troca falhar com um erro que não explica nada.
--   2. O client_secret vai no CORPO, não em header Basic (o Bling é o oposto).
--   3. O PKCE é opcional no ML, mas quando ligado no aplicativo passa a ser
--      obrigatório. Como é ela quem cria o aplicativo, isso vira uma chave
--      guardada em vez de uma suposição.

alter table privado.aplicacoes
  add column if not exists redirect_uri text,
  add column if not exists usa_pkce boolean not null default false;

-- O verificador do PKCE nasce junto com o estado e morre junto com ele.
alter table privado.oauth_estados
  add column if not exists code_verifier text;

/**
 * Guarda as credenciais do aplicativo do Mercado Livre.
 *
 * Elas vêm da tela dela, nunca de conversa nem de arquivo no repositório. A
 * secret não volta em leitura nenhuma: quem quiser trocar, manda a nova.
 */
create or replace function public.salvar_aplicacao_ml(
  p_client_id text,
  p_client_secret text,
  p_redirect_uri text,
  p_usa_pkce boolean default false
) returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.e_admin() then
    return query select false, 'so_admin'; return;
  end if;

  if coalesce(btrim(p_client_id), '') = '' or coalesce(btrim(p_client_secret), '') = '' then
    return query select false, 'faltou_credencial'; return;
  end if;

  -- Sem https o ML recusa o cadastro do próprio aplicativo; recusar aqui dá
  -- uma mensagem em vez de um erro lá na frente, no meio do fluxo.
  if p_redirect_uri !~ '^https://[^ ]+$' then
    return query select false, 'redirect_invalido'; return;
  end if;

  insert into privado.aplicacoes (alvo, client_id, client_secret, redirect_uri, usa_pkce, atualizado_em)
  values ('mercado_livre', btrim(p_client_id), btrim(p_client_secret),
          btrim(p_redirect_uri), coalesce(p_usa_pkce, false), now())
  on conflict (alvo) do update
    set client_id = excluded.client_id,
        client_secret = excluded.client_secret,
        redirect_uri = excluded.redirect_uri,
        usa_pkce = excluded.usa_pkce,
        atualizado_em = now();

  return query select true, 'ok';
end;
$$;

revoke all on function public.salvar_aplicacao_ml(text, text, text, boolean) from public;
grant execute on function public.salvar_aplicacao_ml(text, text, text, boolean) to authenticated;

/**
 * O que a tela pode mostrar sobre o aplicativo — sem a secret.
 */
create or replace function public.aplicacao_ml()
returns table(configurada boolean, client_id text, redirect_uri text, usa_pkce boolean)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.e_admin() then
    return query select false, null::text, null::text, false; return;
  end if;

  return query
  select true, a.client_id, a.redirect_uri, a.usa_pkce
  from privado.aplicacoes a where a.alvo = 'mercado_livre';

  if not found then
    return query select false, null::text, null::text, false;
  end if;
end;
$$;

revoke all on function public.aplicacao_ml() from public;
grant execute on function public.aplicacao_ml() to authenticated;
