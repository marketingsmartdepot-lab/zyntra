-- Refresh token recusado não pode ser tentado de novo.
--
-- O Bling revoga o acesso quando um código de autorização é reusado — está na
-- documentação dele. O mesmo vale para o refresh token: ele rotaciona a cada
-- renovação, e reapresentar um já gasto é tratado como incidente de segurança,
-- não como engano.
--
-- A rotina antiga guardava o refresh recusado e tentava outra vez dez minutos
-- depois, para sempre. Cada tentativa era uma reapresentação do mesmo token
-- morto. Um único tropeço virava um martelo batendo de dez em dez minutos.
--
-- Agora um `invalid_grant` apaga o refresh: a conexão cai de vez, a tela diz
-- para autorizar de novo, e o Bling nunca mais vê aquele token. Falhar uma vez
-- é claramente melhor do que falhar para sempre sem ninguém perceber.
--
-- E a condição de "precisa renovar" deixa de aceitar `expira_em is null`. Sem
-- data de expiração não existe conexão para renovar — sobra uma linha meio
-- preenchida, e tratar isso como urgência fazia a rotina chamar o Bling a cada
-- dez minutos sem ter o que renovar. Foi justamente o estado em que os meus
-- próprios testes deixaram a linha.

create or replace function public.renovar_credencial_erp()
returns table (ok boolean, motivo text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_app record;
  v_cred record;
  v_resposta extensions.http_response;
  v_json jsonb;
  v_corpo text;
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
    select * into v_resposta from extensions.http((
      'POST',
      'https://api.bling.com.br/Api/v3/oauth/token',
      array[
        extensions.http_header('Accept', 'application/json'),
        extensions.http_header(
          'Authorization',
          privado.basic_do_app(v_app.client_id, v_app.client_secret)
        )
      ],
      'application/x-www-form-urlencoded',
      'grant_type=refresh_token&refresh_token=' || extensions.urlencode(v_cred.refresh_token)
    )::extensions.http_request);
  exception when others then
    -- Falha de rede não gasta o token: aqui retentar é o certo.
    update privado.credenciais_erp
       set trava_ate = null, renovacao_erro = 'Falha de rede: ' || sqlerrm where id;
    return query select false, 'rede';
    return;
  end;

  v_corpo := coalesce(v_resposta.content, '');

  if v_resposta.status < 200 or v_resposta.status > 299 then
    if v_corpo like '%invalid_grant%' then
      -- Recusado pelo que o token É, não por acaso. Apagar aqui é o que impede
      -- a rotina de reapresentá-lo a cada dez minutos.
      update privado.credenciais_erp
         set refresh_token = null,
             access_token = null,
             expira_em = null,
             trava_ate = null,
             renovacao_erro = 'O Bling recusou a renovacao: o acesso foi revogado ou ja tinha sido usado. '
                              || 'Autorize de novo — nenhuma tentativa automatica vai resolver isso.'
       where id;
      return query select false, 'revogado';
      return;
    end if;

    update privado.credenciais_erp
       set trava_ate = null,
           renovacao_erro = 'Bling respondeu ' || v_resposta.status || ': ' || left(v_corpo, 300)
     where id;
    return query select false, 'recusado';
    return;
  end if;

  v_json := v_corpo::jsonb;

  if coalesce(v_json->>'access_token', '') = '' then
    update privado.credenciais_erp
       set trava_ate = null,
           renovacao_erro = 'Renovacao sem access_token: ' || left(v_corpo, 300)
     where id;
    return query select false, 'resposta_sem_token';
    return;
  end if;

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

comment on function public.renovar_credencial_erp is
  'Renova o token do Bling. Refresh recusado por invalid_grant e apagado, nao retentado: reapresentar token morto faz o Bling revogar o acesso.';

create or replace function public.renovar_credenciais_vencendo()
returns table (renovadas integer, falhas integer)
language plpgsql security definer set search_path = ''
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
      -- `expira_em is null` saiu daqui: sem data não há conexão viva para
      -- renovar, e tratar isso como vencendo fazia a rotina bater no canal de
      -- dez em dez minutos sem ter o que renovar.
      and c.expira_em is not null
      and c.expira_em < now() + interval '1 hour'
      and (c.trava_ate is null or c.trava_ate < now())
  loop
    select * into v_r from public.renovar_credencial_ml(v_conta);
    if v_r.ok then v_ok := v_ok + 1; else v_erro := v_erro + 1; end if;
  end loop;

  if exists (
    select 1 from privado.credenciais_erp c
    where coalesce(c.refresh_token, '') <> ''
      and c.expira_em is not null
      and c.expira_em < now() + interval '1 hour'
      and (c.trava_ate is null or c.trava_ate < now())
  ) then
    select * into v_r from public.renovar_credencial_erp();
    if v_r.ok then v_ok := v_ok + 1; else v_erro := v_erro + 1; end if;
  end if;

  return query select v_ok, v_erro;
end;
$$;

comment on function public.renovar_credenciais_vencendo is
  'Renova uma hora antes de vencer. Credencial sem expira_em nao e renovada: sem data nao ha conexao viva.';
