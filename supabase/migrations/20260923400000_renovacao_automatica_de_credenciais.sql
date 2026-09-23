-- Renovacao automatica do token, do Mercado Livre e do Bling.
--
-- Sem isto o token expira em horas e tudo para: emissao, etiqueta, baixa. E
-- para calado, acumulando erro na fila ate alguem reconectar na mao.

-- As credenciais DA APLICACAO, que nao mudam. Separadas dos tokens, que mudam
-- toda hora.
create table if not exists privado.aplicacoes (
  alvo text primary key check (alvo in ('mercado_livre', 'bling')),
  client_id text not null,
  client_secret text not null,
  atualizado_em timestamptz not null default now()
);

comment on table privado.aplicacoes is
  'client_id e client_secret de cada integracao. Fora do schema publico: nada no app enxerga.';

alter table privado.aplicacoes enable row level security;

alter table privado.credenciais_erp
  add column if not exists trava_ate timestamptz,
  add column if not exists renovacao_erro text,
  add column if not exists renovado_em timestamptz,
  add column if not exists renovacoes integer not null default 0;

alter table privado.credenciais_conta
  add column if not exists renovacao_erro text;

/**
 * Renova o token de UMA conta do Mercado Livre.
 *
 * A trava e tomada no proprio UPDATE: quem nao conseguir a linha nao renova.
 * Duas renovacoes simultaneas queimariam o refresh token duas vezes e a conta
 * se perderia.
 */
create or replace function public.renovar_credencial_ml(p_conta_id uuid)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app record;
  v_cred record;
  v_resposta extensions.http_response;
  v_json jsonb;
begin
  select * into v_app from privado.aplicacoes where alvo = 'mercado_livre';
  if not found then
    return query select false, 'aplicacao_nao_configurada';
    return;
  end if;

  update privado.credenciais_conta c
     set trava_ate = now() + interval '2 minutes'
   where c.conta_id = p_conta_id
     and (c.trava_ate is null or c.trava_ate < now())
     and coalesce(c.refresh_token, '') <> ''
  returning * into v_cred;

  if not found then
    return query select false, 'travada_ou_sem_refresh';
    return;
  end if;

  begin
    select * into v_resposta from extensions.http((
      'POST',
      'https://api.mercadolibre.com/oauth/token',
      array[extensions.http_header('Accept', 'application/json')],
      'application/x-www-form-urlencoded',
      'grant_type=refresh_token'
        || '&client_id=' || extensions.urlencode(v_app.client_id)
        || '&client_secret=' || extensions.urlencode(v_app.client_secret)
        || '&refresh_token=' || extensions.urlencode(v_cred.refresh_token)
    )::extensions.http_request);
  exception when others then
    update privado.credenciais_conta
       set trava_ate = null, renovacao_erro = 'Falha de rede: ' || sqlerrm
     where conta_id = p_conta_id;
    return query select false, 'rede';
    return;
  end;

  if v_resposta.status < 200 or v_resposta.status > 299 then
    update privado.credenciais_conta
       set trava_ate = null,
           renovacao_erro = 'ML respondeu ' || v_resposta.status || ': '
             || left(coalesce(v_resposta.content, ''), 300)
     where conta_id = p_conta_id;

    -- Refresh recusado significa reconectar a conta na mao. A tela precisa
    -- dizer isso em vez de so falhar.
    update public.contas
       set situacao = 'erro',
           ultimo_erro = 'A conexao com o Mercado Livre precisa ser refeita.'
     where id = p_conta_id;

    return query select false, 'recusado';
    return;
  end if;

  v_json := v_resposta.content::jsonb;

  update privado.credenciais_conta
     set access_token = v_json->>'access_token',
         -- O ML devolve um refresh NOVO. Guardar o antigo perderia a conta na
         -- proxima renovacao.
         refresh_token = coalesce(v_json->>'refresh_token', refresh_token),
         expira_em = now() + make_interval(secs => coalesce((v_json->>'expires_in')::integer, 21600)),
         renovado_em = now(),
         renovacoes = renovacoes + 1,
         renovacao_erro = null,
         trava_ate = null
   where conta_id = p_conta_id;

  update public.contas set situacao = 'conectada', ultimo_erro = null
   where id = p_conta_id and situacao = 'erro';

  return query select true, 'ok';
end;
$$;

comment on function public.renovar_credencial_ml is
  'Renova o token de uma conta do ML. Sincrona: gastar o refresh e gravar o novo na mesma transacao.';

create or replace function public.renovar_credencial_erp()
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app record;
  v_cred record;
  v_resposta extensions.http_response;
  v_json jsonb;
begin
  select * into v_app from privado.aplicacoes where alvo = 'bling';
  if not found then
    return query select false, 'aplicacao_nao_configurada';
    return;
  end if;

  update privado.credenciais_erp c
     set trava_ate = now() + interval '2 minutes'
   where c.id
     and (c.trava_ate is null or c.trava_ate < now())
     and coalesce(c.refresh_token, '') <> ''
  returning * into v_cred;

  if not found then
    return query select false, 'travada_ou_sem_refresh';
    return;
  end if;

  begin
    -- O Bling autentica a aplicacao por Basic, nao no corpo.
    select * into v_resposta from extensions.http((
      'POST',
      'https://api.bling.com.br/Api/v3/oauth/token',
      array[
        extensions.http_header('Accept', 'application/json'),
        extensions.http_header(
          'Authorization',
          'Basic ' || encode((v_app.client_id || ':' || v_app.client_secret)::bytea, 'base64')
        )
      ],
      'application/x-www-form-urlencoded',
      'grant_type=refresh_token&refresh_token=' || extensions.urlencode(v_cred.refresh_token)
    )::extensions.http_request);
  exception when others then
    update privado.credenciais_erp
       set trava_ate = null, renovacao_erro = 'Falha de rede: ' || sqlerrm where id;
    return query select false, 'rede';
    return;
  end;

  if v_resposta.status < 200 or v_resposta.status > 299 then
    update privado.credenciais_erp
       set trava_ate = null,
           renovacao_erro = 'Bling respondeu ' || v_resposta.status || ': '
             || left(coalesce(v_resposta.content, ''), 300)
     where id;
    return query select false, 'recusado';
    return;
  end if;

  v_json := v_resposta.content::jsonb;

  update privado.credenciais_erp
     set access_token = v_json->>'access_token',
         refresh_token = coalesce(v_json->>'refresh_token', refresh_token),
         expira_em = now() + make_interval(secs => coalesce((v_json->>'expires_in')::integer, 21600)),
         renovado_em = now(),
         renovacoes = renovacoes + 1,
         renovacao_erro = null,
         trava_ate = null,
         atualizado_em = now()
   where id;

  return query select true, 'ok';
end;
$$;

/**
 * Renova tudo que esta perto de vencer.
 *
 * Uma hora de antecedencia, nao um minuto: se a renovacao falhar, o token
 * atual ainda funciona e ha tempo de tentar de novo antes de a operacao parar.
 */
create or replace function public.renovar_credenciais_vencendo()
returns table (renovadas integer, falhas integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta uuid;
  v_r record;
  v_ok integer := 0;
  v_erro integer := 0;
begin
  for v_conta in
    select c.conta_id
    from privado.credenciais_conta c
    where coalesce(c.refresh_token, '') <> ''
      and (c.expira_em is null or c.expira_em < now() + interval '1 hour')
      and (c.trava_ate is null or c.trava_ate < now())
  loop
    select * into v_r from public.renovar_credencial_ml(v_conta);
    if v_r.ok then v_ok := v_ok + 1; else v_erro := v_erro + 1; end if;
  end loop;

  if exists (
    select 1 from privado.credenciais_erp c
    where coalesce(c.refresh_token, '') <> ''
      and (c.expira_em is null or c.expira_em < now() + interval '1 hour')
      and (c.trava_ate is null or c.trava_ate < now())
  ) then
    select * into v_r from public.renovar_credencial_erp();
    if v_r.ok then v_ok := v_ok + 1; else v_erro := v_erro + 1; end if;
  end if;

  return query select v_ok, v_erro;
end;
$$;

comment on function public.renovar_credenciais_vencendo is
  'Renova com uma hora de antecedencia: se falhar, o token atual ainda funciona e ha tempo de tentar de novo.';

-- Para a tela saber a saude das conexoes sem enxergar token nenhum.
create or replace view public.saude_das_conexoes as
select
  ct.id as conta_id,
  ct.apelido,
  'mercado_livre'::text as alvo,
  (c.access_token is not null) as conectada,
  c.expira_em,
  (c.expira_em is not null and c.expira_em < now()) as expirada,
  c.renovado_em,
  c.renovacoes,
  c.renovacao_erro
from public.contas ct
left join privado.credenciais_conta c on c.conta_id = ct.id
union all
select
  null,
  'Bling',
  'bling',
  (e.access_token is not null),
  e.expira_em,
  (e.expira_em is not null and e.expira_em < now()),
  e.renovado_em,
  e.renovacoes,
  e.renovacao_erro
from privado.credenciais_erp e;

comment on view public.saude_das_conexoes is
  'Saude das conexoes para a tela: diz SE esta conectada e quando vence, nunca o token.';

grant select on public.saude_das_conexoes to authenticated;

revoke execute on function public.renovar_credencial_ml(uuid) from public, anon, authenticated;
revoke execute on function public.renovar_credencial_erp() from public, anon, authenticated;
revoke execute on function public.renovar_credenciais_vencendo() from public, anon, authenticated;

-- De dez em dez minutos. Com uma hora de antecedencia, sao seis chances antes
-- de o token vencer de verdade.
select cron.schedule('zyntra-renova-credenciais', '*/10 * * * *',
  $cron$ select public.renovar_credenciais_vencendo() $cron$);
