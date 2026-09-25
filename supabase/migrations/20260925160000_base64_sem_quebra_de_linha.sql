-- O `encode(..., 'base64')` do Postgres quebra a linha a cada 76 caracteres.
--
-- Com credencial de verdade (client_id de 32 + secret longo = ~97 caracteres),
-- o base64 passa de 76 e ganha um \n NO MEIO do cabeçalho Authorization.
-- Cabeçalho HTTP com quebra de linha é inválido: o curl se recusa a enviar, e
-- a mensagem que volta é "Failed sending HTTP POST request" — que parece
-- problema de rede e não é. O pedido nunca sai da máquina.
--
-- Todos os meus testes passaram por acidente: credencial falsa é curta e não
-- chega aos 76 caracteres. Só a primeira conexão real revelou.
--
-- A mesma falha estava na renovação, que já existia desde antes. Ela teria
-- falhado calada a cada dez minutos, para sempre, com uma mensagem que
-- mandaria procurar firewall em vez de olhar o cabeçalho.

create or replace function privado.basic_do_app(p_client_id text, p_client_secret text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- replace(..., E'\n', '') é a correção inteira: base64 numa linha só.
  select 'Basic ' || replace(
    encode((p_client_id || ':' || p_client_secret)::bytea, 'base64'),
    E'\n', ''
  );
$$;

comment on function privado.basic_do_app is
  'Cabecalho Basic numa linha so. O encode base64 do Postgres quebra a cada 76 caracteres, e isso invalida o cabecalho.';

revoke all on function privado.basic_do_app(text, text) from public, anon, authenticated;

-- As duas funções que falam com o Bling passam a montar o cabeçalho por aqui.
-- O corpo delas não muda; só a linha do Authorization. Estão reescritas
-- inteiras porque `create or replace function` não aceita menos que isso.

create or replace function public.concluir_oauth_erp(p_estado text, p_code text)
returns table (ok boolean, motivo text, detalhe text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_app record;
  v_estado record;
  v_resposta extensions.http_response;
  v_json jsonb;
  v_falha text;
begin
  if not public.e_admin() then
    return query select false, 'so_admin', null::text; return;
  end if;

  select * into v_app from privado.aplicacoes where alvo = 'bling';
  if not found then
    return query select false, 'aplicacao_nao_configurada', null::text; return;
  end if;

  -- Consumir ANTES de falar com o Bling: reusar o código faz ele revogar tudo.
  update privado.oauth_estados e
     set usado_em = now()
   where e.estado = p_estado
     and e.alvo = 'bling'
     and e.usado_em is null
     and e.expira_em > now()
     and e.iniciado_por = auth.uid()
  returning * into v_estado;

  if not found then
    return query select false, 'estado_invalido', null::text; return;
  end if;

  if coalesce(btrim(p_code), '') = '' then
    return query select false, 'sem_codigo', null::text; return;
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
      'grant_type=authorization_code&code=' || extensions.urlencode(btrim(p_code))
    )::extensions.http_request);
  exception when others then
    v_falha := 'Falha de rede ao falar com o Bling: ' || sqlerrm;
    perform public.registrar_falha_erp(v_falha);
    return query select false, 'rede', v_falha; return;
  end;

  if v_resposta.status < 200 or v_resposta.status > 299 then
    v_falha := 'Bling respondeu ' || v_resposta.status || ': '
               || left(coalesce(v_resposta.content, ''), 400);
    perform public.registrar_falha_erp(v_falha);
    return query select false, 'recusado', v_falha; return;
  end if;

  v_json := v_resposta.content::jsonb;

  if coalesce(v_json->>'access_token', '') = '' then
    v_falha := 'O Bling respondeu sem access_token: '
               || left(coalesce(v_resposta.content, ''), 400);
    perform public.registrar_falha_erp(v_falha);
    return query select false, 'resposta_sem_token', v_falha; return;
  end if;

  insert into privado.credenciais_erp (id, access_token, refresh_token, expira_em,
                                       renovado_em, renovacao_erro, trava_ate, atualizado_em)
  values (
    true,
    v_json->>'access_token',
    v_json->>'refresh_token',
    now() + make_interval(secs => coalesce((v_json->>'expires_in')::integer, 21600)),
    now(), null, null, now()
  )
  on conflict (id) do update
    set access_token = excluded.access_token,
        refresh_token = coalesce(excluded.refresh_token, privado.credenciais_erp.refresh_token),
        expira_em = excluded.expira_em,
        renovado_em = now(),
        renovacao_erro = null,
        trava_ate = null,
        atualizado_em = now();

  return query select true, 'ok', null::text;
end;
$$;

comment on function public.concluir_oauth_erp is
  'Troca o codigo pelo token. O state e consumido antes da chamada: reusar codigo faz o Bling revogar o acesso.';

create or replace function public.renovar_credencial_erp()
returns table (ok boolean, motivo text)
language plpgsql security definer set search_path = ''
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
    -- O Bling autentica a aplicação por Basic, não no corpo.
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

comment on function public.renovar_credencial_erp is
  'Renova o token do Bling. Sincrona: gastar o refresh e gravar o novo na mesma transacao.';
