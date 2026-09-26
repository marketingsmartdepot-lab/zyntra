/**
 * Troca o código pelo token e guarda a conta.
 *
 * Quatro coisas que a documentação do ML obriga e que, se esquecidas, falham
 * calado ou destroem acesso:
 *
 *   1. `redirect_uri` vai TAMBÉM na troca, e igual ao do pedido.
 *   2. O client_secret vai no corpo, não em header.
 *   3. Código reusado devolve invalid_grant — por isso o estado é consumido
 *      numa só operação, antes de qualquer chamada de rede.
 *   4. A resposta traz `user_id`, e é ele a identidade da conta. Numa
 *      reconexão, user_id diferente significa que a pessoa entrou na conta
 *      errada do ML: gravar assim trocaria a credencial de uma conta pela de
 *      outra, e ninguém notaria até a etiqueta sair pela loja errada.
 */
create or replace function public.concluir_oauth_conta(p_estado text, p_code text)
returns table(ok boolean, motivo text, detalhe text, conta_id uuid)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_app record;
  v_estado record;
  v_resposta extensions.http_response;
  v_json jsonb;
  v_erro text;
  v_user_id text;
  v_canal uuid;
  v_conta uuid;
  v_apelido text;
  v_corpo text;
begin
  if not public.e_admin() then
    return query select false, 'so_admin', null::text, null::uuid; return;
  end if;

  select * into v_app from privado.aplicacoes a where a.alvo = 'mercado_livre';
  if not found then
    return query select false, 'aplicacao_nao_configurada', null::text, null::uuid; return;
  end if;

  -- Consumir o estado é a primeira coisa: é ele que impede a segunda passagem
  -- (alguém atualizar a página) de reusar o código e derrubar o acesso.
  update privado.oauth_estados e
     set usado_em = now()
   where e.estado = p_estado
     and e.alvo = 'mercado_livre'
     and e.usado_em is null
     and e.expira_em > now()
     and e.iniciado_por = auth.uid()
  returning * into v_estado;

  if not found then
    return query select false, 'estado_invalido', null::text, null::uuid; return;
  end if;

  if coalesce(btrim(p_code), '') = '' then
    return query select false, 'sem_codigo', null::text, null::uuid; return;
  end if;

  v_corpo := 'grant_type=authorization_code'
    || '&client_id=' || extensions.urlencode(v_app.client_id)
    || '&client_secret=' || extensions.urlencode(v_app.client_secret)
    || '&code=' || extensions.urlencode(btrim(p_code))
    || '&redirect_uri=' || extensions.urlencode(v_app.redirect_uri)
    || case when v_estado.code_verifier is not null
            then '&code_verifier=' || extensions.urlencode(v_estado.code_verifier)
            else '' end;

  -- Curto de propósito: o tempo de consulta do usuário autenticado é de 8s, e
  -- ainda há uma segunda chamada depois desta.
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '5000');

  begin
    select * into v_resposta from extensions.http((
      'POST',
      'https://api.mercadolibre.com/oauth/token',
      array[extensions.http_header('Accept', 'application/json')],
      'application/x-www-form-urlencoded',
      v_corpo
    )::extensions.http_request);
  exception when others then
    return query select false, 'rede',
      'Falha de rede ao falar com o Mercado Livre: ' || sqlerrm, null::uuid; return;
  end;

  if v_resposta.status < 200 or v_resposta.status > 299 then
    v_erro := coalesce(
      (nullif(v_resposta.content, '')::jsonb)->>'error',
      'http_' || v_resposta.status);
    return query select false,
      case v_erro
        when 'invalid_grant' then 'codigo_expirado'
        when 'invalid_client' then 'credencial_do_app_errada'
        else 'recusado'
      end,
      'O Mercado Livre respondeu ' || v_resposta.status || ': '
        || left(coalesce(v_resposta.content, ''), 400),
      null::uuid;
    return;
  end if;

  v_json := v_resposta.content::jsonb;
  v_user_id := v_json->>'user_id';

  if coalesce(v_json->>'access_token', '') = '' or coalesce(v_user_id, '') = '' then
    return query select false, 'resposta_incompleta',
      left(coalesce(v_resposta.content, ''), 400), null::uuid; return;
  end if;

  -- Reconexão: tem de ser a MESMA conta do ML.
  if v_estado.conta_id is not null then
    if exists (select 1 from public.contas c
                where c.id = v_estado.conta_id
                  and c.ref_externa is not null
                  and c.ref_externa <> v_user_id) then
      return query select false, 'conta_do_ml_diferente',
        'Esta conta já está ligada a outro usuário do Mercado Livre. '
        || 'Saia do Mercado Livre e entre na conta certa antes de reconectar.',
        v_estado.conta_id;
      return;
    end if;
    v_conta := v_estado.conta_id;
  end if;

  select id into v_canal from public.canais where slug = 'mercado_livre';
  if v_canal is null then
    return query select false, 'canal_inexistente', null::text, null::uuid; return;
  end if;

  -- O apelido é enfeite: se a busca demorar ou falhar, a conta entra com o
  -- número e ela renomeia. Perder o token por causa do nome seria absurdo.
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '2500');
    select * into v_resposta from extensions.http((
      'GET',
      'https://api.mercadolibre.com/users/me',
      array[
        extensions.http_header('Accept', 'application/json'),
        extensions.http_header('Authorization', 'Bearer ' || (v_json->>'access_token'))
      ],
      null, null
    )::extensions.http_request);

    if v_resposta.status between 200 and 299 then
      v_apelido := (v_resposta.content::jsonb)->>'nickname';
    end if;
  exception when others then
    v_apelido := null;
  end;

  v_apelido := coalesce(nullif(btrim(coalesce(v_apelido, '')), ''), 'conta ' || v_user_id);

  if v_conta is null then
    insert into public.contas (canal_id, ref_externa, apelido, situacao, conectada_em, ultimo_erro)
    values (v_canal, v_user_id, v_apelido, 'conectada', now(), null)
    on conflict (canal_id, ref_externa) do update
      set situacao = 'conectada', conectada_em = now(), ultimo_erro = null,
          atualizado_em = now()
    returning id into v_conta;
  else
    update public.contas c
       set ref_externa = v_user_id,
           apelido = case when c.ref_externa is null then v_apelido else c.apelido end,
           situacao = 'conectada', conectada_em = now(), ultimo_erro = null,
           atualizado_em = now()
     where c.id = v_conta;
  end if;

  insert into privado.credenciais_conta
    (conta_id, access_token, refresh_token, expira_em, escopo,
     renovado_em, renovacao_erro, trava_ate, atualizado_em)
  values (
    v_conta,
    v_json->>'access_token',
    v_json->>'refresh_token',
    now() + make_interval(secs => coalesce((v_json->>'expires_in')::integer, 21600)),
    v_json->>'scope',
    now(), null, null, now())
  on conflict (conta_id) do update
    set access_token = excluded.access_token,
        refresh_token = coalesce(excluded.refresh_token, privado.credenciais_conta.refresh_token),
        expira_em = excluded.expira_em,
        escopo = excluded.escopo,
        renovado_em = now(),
        renovacao_erro = null,
        trava_ate = null,
        atualizado_em = now();

  return query select true, 'ok', null::text, v_conta;
end;
$$;

revoke all on function public.concluir_oauth_conta(text, text) from public;
grant execute on function public.concluir_oauth_conta(text, text) to authenticated;
