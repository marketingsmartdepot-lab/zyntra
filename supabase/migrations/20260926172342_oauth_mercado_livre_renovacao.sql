/**
 * Renova o token de uma conta do Mercado Livre.
 *
 * O refresh do ML é de USO ÚNICO e gira a cada uso: a resposta traz um novo, e
 * o antigo morre na hora. Duas consequências que o código precisa respeitar:
 *
 *   1. Duas renovações simultâneas com o mesmo refresh matam o acesso. Por
 *      isso a linha é travada (`for update`) e quem chegar depois já encontra
 *      o token novo.
 *   2. Quando o ML responde `invalid_grant`, o refresh guardado não serve mais
 *      para nada. Insistir com ele é o que transforma uma falha passageira em
 *      conta morta — já aconteceu neste projeto com o Bling. Então ele é
 *      APAGADO e a conta fica marcada para reconectar.
 */
create or replace function public.renovar_token_conta(p_conta_id uuid)
returns table(ok boolean, motivo text, detalhe text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_app record;
  v_cred record;
  v_resposta extensions.http_response;
  v_json jsonb;
  v_erro text;
begin
  select * into v_app from privado.aplicacoes a where a.alvo = 'mercado_livre';
  if not found then
    return query select false, 'aplicacao_nao_configurada', null::text; return;
  end if;

  select * into v_cred from privado.credenciais_conta c
   where c.conta_id = p_conta_id for update;

  if not found then
    return query select false, 'conta_sem_credencial', null::text; return;
  end if;

  -- Alguém renovou enquanto esta chamada esperava a trava.
  if v_cred.expira_em > now() + interval '10 minutes' then
    return query select true, 'ja_estava_valido', null::text; return;
  end if;

  if coalesce(btrim(coalesce(v_cred.refresh_token, '')), '') = '' then
    return query select false, 'precisa_reconectar',
      'Não há refresh token guardado — a conta precisa autorizar de novo.'; return;
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '5000');

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
    -- Falha de rede NÃO apaga o refresh: ele continua bom, o problema foi o
    -- caminho. Só recua um pouco antes de tentar de novo.
    update privado.credenciais_conta c
       set renovacao_erro = 'rede: ' || sqlerrm,
           trava_ate = now() + interval '2 minutes',
           atualizado_em = now()
     where c.conta_id = p_conta_id;
    return query select false, 'rede', sqlerrm; return;
  end;

  if v_resposta.status < 200 or v_resposta.status > 299 then
    v_erro := coalesce((nullif(v_resposta.content, '')::jsonb)->>'error',
                       'http_' || v_resposta.status);

    if v_erro in ('invalid_grant', 'invalid_client', 'unauthorized_client') then
      -- Acabou. Apagar o refresh é o que impede a repetição eterna.
      update privado.credenciais_conta c
         set refresh_token = null,
             access_token = null,
             renovacao_erro = v_erro,
             trava_ate = null,
             atualizado_em = now()
       where c.conta_id = p_conta_id;

      update public.contas c
         set situacao = 'desconectada',
             ultimo_erro = 'O Mercado Livre recusou a renovação (' || v_erro
                           || '). É preciso conectar a conta de novo.',
             atualizado_em = now()
       where c.id = p_conta_id;

      return query select false, 'precisa_reconectar', v_erro; return;
    end if;

    update privado.credenciais_conta c
       set renovacao_erro = v_erro,
           trava_ate = now() + interval '2 minutes',
           atualizado_em = now()
     where c.conta_id = p_conta_id;

    return query select false, 'recusado',
      'O Mercado Livre respondeu ' || v_resposta.status || ': '
      || left(coalesce(v_resposta.content, ''), 400); return;
  end if;

  v_json := v_resposta.content::jsonb;

  if coalesce(v_json->>'access_token', '') = '' then
    return query select false, 'resposta_incompleta',
      left(coalesce(v_resposta.content, ''), 400); return;
  end if;

  update privado.credenciais_conta c
     set access_token = v_json->>'access_token',
         refresh_token = coalesce(v_json->>'refresh_token', c.refresh_token),
         expira_em = now() + make_interval(
           secs => coalesce((v_json->>'expires_in')::integer, 21600)),
         escopo = coalesce(v_json->>'scope', c.escopo),
         renovado_em = now(),
         renovacoes = c.renovacoes + 1,
         renovacao_erro = null,
         trava_ate = null,
         atualizado_em = now()
   where c.conta_id = p_conta_id;

  update public.contas c
     set situacao = 'conectada', ultimo_erro = null, atualizado_em = now()
   where c.id = p_conta_id and c.situacao <> 'conectada';

  return query select true, 'ok', null::text;
end;
$$;

-- Só o servidor renova. Não há motivo para o navegador chamar isto.
revoke all on function public.renovar_token_conta(uuid) from public, anon, authenticated;
