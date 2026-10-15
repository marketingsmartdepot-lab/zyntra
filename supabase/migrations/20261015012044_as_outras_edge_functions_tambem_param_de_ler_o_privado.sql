-- O mesmo defeito da função `nota` estava em mais duas, e numa delas AO VIVO:
--
--   etiqueta  -> PUBLICADA e chamada por src/app/expedicao/etiqueta.ts.
--                Lê privado.credenciais_conta pelo PostgREST, então o caminho
--                de buscar etiqueta na tela está quebrado hoje. (A etiqueta do
--                dia a dia funciona porque vem por outro caminho: o cron
--                pedir_etiquetas_ml chama a rota /api/ml/etiquetas do app.)
--   catalogo  -> não publicada. Lê privado.credenciais_erp do mesmo jeito.
--
-- `token_do_canal` já resolve o lado do ML. Falta o do Bling, que não tinha
-- equivalente a privado.token_ml — só renovar_credencial_erp().

/**
 * O token do Bling, renovado se estiver vencendo.
 *
 * Mesma forma de privado.token_ml: ou devolve token bom, ou o motivo. A
 * renovação é tentada a 5 minutos do vencimento; se ela falhar por algo
 * passageiro, o token velho ainda é o que há e vale tentar.
 */
create or replace function public.token_do_erp()
returns table (token text, motivo text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cred record;
  v_r record;
begin
  select * into v_cred from privado.credenciais_erp limit 1;

  if not found or coalesce(v_cred.access_token, '') = '' then
    return query select null::text, 'sem_conexao'; return;
  end if;

  if v_cred.expira_em is null or v_cred.expira_em > now() + interval '5 minutes' then
    return query select v_cred.access_token, 'ok'; return;
  end if;

  select * into v_r from public.renovar_credencial_erp();

  if v_r.ok then
    select c.access_token into v_cred.access_token from privado.credenciais_erp c limit 1;
    return query select v_cred.access_token, 'ok'; return;
  end if;

  if v_r.motivo = 'precisa_reconectar' then
    return query select null::text, 'precisa_reconectar'; return;
  end if;

  return query select v_cred.access_token, 'ok';
end;
$$;

comment on function public.token_do_erp is
  'Token do Bling, renovado se vencendo. Só service_role.';

revoke all on function public.token_do_erp() from public, anon, authenticated;
grant execute on function public.token_do_erp() to service_role;
