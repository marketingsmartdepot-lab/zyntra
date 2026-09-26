/**
 * Começa a conexão de uma conta do Mercado Livre.
 *
 * Sem conta informada é conta NOVA: qual é só se sabe depois, quando o ML
 * devolve o user_id. Com conta informada é reconexão — e aí o user_id que
 * voltar tem de ser o mesmo, senão seria trocar a credencial de uma conta
 * pela de outra sem ninguém perceber.
 */
create or replace function public.iniciar_oauth_conta(p_conta_id uuid default null)
returns table(ok boolean, motivo text, url text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_app record;
  v_estado text;
  v_verifier text;
  v_challenge text;
begin
  if not public.e_admin() then
    return query select false, 'so_admin', null::text; return;
  end if;

  select * into v_app from privado.aplicacoes a where a.alvo = 'mercado_livre';
  if not found then
    return query select false, 'aplicacao_nao_configurada', null::text; return;
  end if;
  if coalesce(btrim(v_app.redirect_uri), '') = '' then
    return query select false, 'sem_redirect_uri', null::text; return;
  end if;

  if p_conta_id is not null
     and not exists (select 1 from public.contas c where c.id = p_conta_id) then
    return query select false, 'conta_nao_encontrada', null::text; return;
  end if;

  v_estado := encode(extensions.gen_random_bytes(24), 'hex');

  if v_app.usa_pkce then
    -- 64 caracteres hexadecimais: dentro dos 43..128 que o padrão exige e
    -- inteiramente dentro do alfabeto permitido.
    v_verifier := encode(extensions.gen_random_bytes(32), 'hex');
    -- base64url, sem preenchimento. O replace da quebra de linha não é zelo
    -- à toa: o encode do Postgres quebra a cada 76 caracteres, e isso já
    -- estragou um header neste projeto.
    v_challenge := rtrim(
      translate(
        replace(encode(extensions.digest(v_verifier, 'sha256'), 'base64'), E'\n', ''),
        '+/', '-_'),
      '=');
  end if;

  insert into privado.oauth_estados (estado, alvo, conta_id, iniciado_por, code_verifier)
  values (v_estado, 'mercado_livre', p_conta_id, auth.uid(), v_verifier);

  delete from privado.oauth_estados where expira_em < now() - interval '1 day';

  return query select
    true,
    'ok',
    'https://auth.mercadolivre.com.br/authorization'
      || '?response_type=code'
      || '&client_id=' || extensions.urlencode(v_app.client_id)
      || '&redirect_uri=' || extensions.urlencode(v_app.redirect_uri)
      || '&state=' || v_estado
      || case when v_app.usa_pkce
              then '&code_challenge=' || extensions.urlencode(v_challenge)
                || '&code_challenge_method=S256'
              else '' end;
end;
$$;

revoke all on function public.iniciar_oauth_conta(uuid) from public;
grant execute on function public.iniciar_oauth_conta(uuid) to authenticated;
