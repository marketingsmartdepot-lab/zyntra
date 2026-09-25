-- A troca do código pelo token, e o erro do Bling ficando visível.
--
-- Quando falha, a resposta crua do Bling é gravada em `renovacao_erro`, que a
-- view saude_das_conexoes já mostra. É melhor que carregar o texto por query
-- string até o navegador: uma coisa a menos passeando pela URL, e o erro
-- sobrevive a um F5.

create or replace function public.registrar_falha_erp(p_erro text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into privado.credenciais_erp (id, renovacao_erro, atualizado_em)
  values (true, p_erro, now())
  on conflict (id) do update
    set renovacao_erro = excluded.renovacao_erro, atualizado_em = now();
end;
$$;

comment on function public.registrar_falha_erp is
  'Guarda o ultimo erro da conexao com o Bling onde a tela ja le. Interna: ninguem de fora chama.';

revoke all on function public.registrar_falha_erp(text) from public, anon, authenticated;

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
  -- Se a pessoa atualizar a página de retorno, a segunda passagem morre aqui.
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
          'Basic ' || encode((v_app.client_id || ':' || v_app.client_secret)::bytea, 'base64')
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
    -- A resposta crua vai para a tela. "Falhou" mandaria a pessoa adivinhar;
    -- o `description` do Bling diz o que está errado.
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
        -- A linha que já existia se referencia pelo nome da tabela.
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

revoke all on function public.concluir_oauth_erp(text, text) from public, anon;
grant execute on function public.concluir_oauth_erp(text, text) to authenticated;
