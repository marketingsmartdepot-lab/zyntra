/**
 * Devolve um access token válido de uma conta do Mercado Livre.
 *
 * Renova sozinho quando está perto de vencer. Quem chama não precisa saber que
 * o token do ML dura 6 horas — só pede e usa.
 *
 * Se outra renovação estiver em curso (a trava), devolve o token atual em vez
 * de esperar: ou ele ainda serve, ou a chamada seguinte falha com 401 e o
 * chamador trata. Esperar aqui seria segurar uma conexão do banco à toa.
 */
create or replace function privado.token_ml(p_conta_id uuid)
returns table(token text, motivo text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cred record;
  v_r record;
begin
  select * into v_cred from privado.credenciais_conta c where c.conta_id = p_conta_id;

  if not found or coalesce(v_cred.access_token, '') = '' then
    return query select null::text, 'sem_conexao'; return;
  end if;

  if v_cred.expira_em is null or v_cred.expira_em > now() + interval '5 minutes' then
    return query select v_cred.access_token, 'ok'; return;
  end if;

  select * into v_r from public.renovar_credencial_ml(p_conta_id);

  if v_r.ok then
    select c.access_token into v_cred.access_token
    from privado.credenciais_conta c where c.conta_id = p_conta_id;
    return query select v_cred.access_token, 'ok'; return;
  end if;

  if v_r.motivo = 'precisa_reconectar' then
    return query select null::text, 'precisa_reconectar'; return;
  end if;

  -- Renovação travada ou passageiramente recusada: o token velho é o que há.
  return query select v_cred.access_token, 'ok';
end;
$$;

revoke all on function privado.token_ml(uuid) from public, anon, authenticated;
