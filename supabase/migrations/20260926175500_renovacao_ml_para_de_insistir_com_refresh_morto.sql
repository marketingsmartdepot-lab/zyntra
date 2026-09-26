-- Havia DUAS renovações do Mercado Livre: esta, que o cron chama de 10 em 10
-- minutos, e `renovar_token_conta`, que eu escrevi sem ver esta. Fica uma só —
-- a que o cron já conhece — com o que faltava nela.
--
-- O que faltava é o mesmo defeito que derrubou a conexão do Bling esta
-- semana: quando o ML recusa o refresh, ele não serve mais para nada, mas a
-- versão anterior guardava o erro e DEIXAVA o refresh gravado. O cron então
-- voltava a cada 10 minutos, para sempre, com um token morto. Com 28 contas
-- isso é bater na API sem parar e arriscar o bloqueio por excesso de
-- requisições que a própria documentação do ML descreve.
--
-- Agora a recusa definitiva APAGA o refresh, e é a ausência dele que tira a
-- conta da fila do cron. A tela pede para reconectar.

drop function if exists public.renovar_token_conta(uuid);

create or replace function public.renovar_credencial_ml(p_conta_id uuid)
returns table(ok boolean, motivo text)
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
    return query select false, 'aplicacao_nao_configurada'; return;
  end if;

  -- A trava é tomada no mesmo update que lê a linha: é isso que impede duas
  -- renovações simultâneas de gastarem o mesmo refresh. O refresh do ML é de
  -- uso único — duas ao mesmo tempo matam a conta.
  update privado.credenciais_conta c
     set trava_ate = now() + interval '2 minutes'
   where c.conta_id = p_conta_id
     and (c.trava_ate is null or c.trava_ate < now())
     and coalesce(c.refresh_token, '') <> ''
  returning * into v_cred;

  if not found then
    return query select false, 'travada_ou_sem_refresh'; return;
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
    -- Falha de rede NÃO apaga o refresh: ele continua bom, o caminho é que
    -- falhou. A trava fica de pé como recuo, em vez de liberar para tentar de
    -- novo em seguida.
    update privado.credenciais_conta c
       set renovacao_erro = 'Falha de rede: ' || sqlerrm
     where c.conta_id = p_conta_id;
    return query select false, 'rede'; return;
  end;

  if v_resposta.status < 200 or v_resposta.status > 299 then
    v_erro := coalesce((nullif(v_resposta.content, '')::jsonb)->>'error',
                       'http_' || v_resposta.status);

    if v_erro in ('invalid_grant', 'invalid_client', 'unauthorized_client') then
      -- Acabou: este refresh nunca mais vai funcionar. Apagá-lo é o que tira
      -- a conta da fila do cron e impede a repetição eterna.
      update privado.credenciais_conta c
         set refresh_token = null,
             access_token = null,
             renovacao_erro = v_erro,
             trava_ate = null
       where c.conta_id = p_conta_id;

      update public.contas c
         set situacao = 'desconectada',
             ultimo_erro = 'O Mercado Livre recusou a renovação (' || v_erro
                           || '). É preciso conectar esta conta de novo.',
             atualizado_em = now()
       where c.id = p_conta_id;

      return query select false, 'precisa_reconectar'; return;
    end if;

    -- Recusa passageira (429, 5xx): guarda o motivo e deixa a trava recuar.
    update privado.credenciais_conta c
       set renovacao_erro = 'ML respondeu ' || v_resposta.status || ': '
             || left(coalesce(v_resposta.content, ''), 300)
     where c.conta_id = p_conta_id;

    update public.contas c
       set situacao = 'erro',
           ultimo_erro = 'O Mercado Livre não renovou agora (' || v_erro
                         || '). Vai tentar de novo sozinho.',
           atualizado_em = now()
     where c.id = p_conta_id;

    return query select false, 'recusado'; return;
  end if;

  v_json := v_resposta.content::jsonb;

  if coalesce(v_json->>'access_token', '') = '' then
    update privado.credenciais_conta c
       set renovacao_erro = 'resposta sem access_token'
     where c.conta_id = p_conta_id;
    return query select false, 'resposta_incompleta'; return;
  end if;

  update privado.credenciais_conta c
     set access_token = v_json->>'access_token',
         -- O ML devolve um refresh NOVO e mata o antigo na hora. Guardar o
         -- antigo perderia a conta na próxima renovação.
         refresh_token = coalesce(v_json->>'refresh_token', c.refresh_token),
         expira_em = now() + make_interval(
           secs => coalesce((v_json->>'expires_in')::integer, 21600)),
         escopo = coalesce(v_json->>'scope', c.escopo),
         renovado_em = now(),
         renovacoes = c.renovacoes + 1,
         renovacao_erro = null,
         trava_ate = null
   where c.conta_id = p_conta_id;

  update public.contas c
     set situacao = 'conectada', ultimo_erro = null, atualizado_em = now()
   where c.id = p_conta_id and c.situacao <> 'conectada';

  return query select true, 'ok';
end;
$$;

revoke all on function public.renovar_credencial_ml(uuid) from public, anon, authenticated;
