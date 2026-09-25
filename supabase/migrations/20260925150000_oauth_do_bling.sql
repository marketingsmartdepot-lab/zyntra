-- A primeira conexão com o Bling.
--
-- A renovação já existia; o que faltava era a autorização inicial. Duas
-- descobertas da análise da API do Bling mandaram no desenho:
--
--   1. Reusar o authorization_code não dá apenas erro: o Bling REVOGA o acesso
--      do usuário, por segurança. Então um retorno repetido (a pessoa atualiza
--      a página) não pode tocar no Bling de novo. O estado é consumido ANTES da
--      chamada, e um segundo retorno morre aqui dentro.
--   2. O código expira em 1 minuto. A troca acontece no servidor, no ato.
--
-- Confirmado contra o endpoint real, com credencial falsa: a credencial vai no
-- cabeçalho Basic ("Client credentials were not found in the headers" quando
-- falta), o corpo pode ser form-urlencoded, e `redirect_uri` não entra no
-- corpo — o endereço de retorno é o cadastrado no aplicativo do Bling.

create table if not exists privado.oauth_estados (
  estado text primary key,
  alvo text not null check (alvo in ('bling', 'mercado_livre')),
  conta_id uuid references public.contas (id) on delete cascade,
  iniciado_por uuid references public.perfis (id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '10 minutes',
  usado_em timestamptz
);

comment on table privado.oauth_estados is
  'O `state` do OAuth: prova que o retorno veio de uma autorizacao que NOS comecamos. Uso unico e com validade.';

alter table privado.oauth_estados enable row level security;

create index if not exists oauth_estados_limpeza_idx
  on privado.oauth_estados (expira_em) where usado_em is null;

create or replace function public.definir_aplicacao_erp(
  p_client_id text,
  p_client_secret text
)
returns table (ok boolean, motivo text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_id text := btrim(coalesce(p_client_id, ''));
  v_secret text := btrim(coalesce(p_client_secret, ''));
begin
  if not public.e_admin() then
    return query select false, 'so_admin'; return;
  end if;

  if v_id = '' or v_secret = '' then
    return query select false, 'faltou_dado'; return;
  end if;

  insert into privado.aplicacoes (alvo, client_id, client_secret)
  values ('bling', v_id, v_secret)
  on conflict (alvo) do update
    set client_id = excluded.client_id,
        client_secret = excluded.client_secret,
        atualizado_em = now();

  -- Token emitido para OUTRO aplicativo não vale nada. Guardar seria mentir
  -- na tela dizendo "conectado" enquanto toda chamada falha.
  update privado.credenciais_erp
     set access_token = null, refresh_token = null, expira_em = null,
         renovacao_erro = null, atualizado_em = now()
   where id;

  return query select true, 'ok';
end;
$$;

comment on function public.definir_aplicacao_erp is
  'Guarda client_id e secret do app do Bling. Trocar o app apaga o token antigo: token de outro app nao vale.';

create or replace function public.erp_aplicacao_resumo()
returns table (configurada boolean, client_id_final text, atualizado_em timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.e_admin() then
    return query select false, null::text, null::timestamptz; return;
  end if;

  return query
  select true, '...' || right(a.client_id, 6), a.atualizado_em
  from privado.aplicacoes a
  where a.alvo = 'bling';
end;
$$;

comment on function public.erp_aplicacao_resumo is
  'Se o app do Bling esta cadastrado, e so o final do client_id para conferencia. O secret nunca sai daqui.';

create or replace function public.iniciar_oauth_erp()
returns table (ok boolean, motivo text, url text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_client_id text;
  v_estado text;
begin
  if not public.e_admin() then
    return query select false, 'so_admin', null::text; return;
  end if;

  select a.client_id into v_client_id
  from privado.aplicacoes a where a.alvo = 'bling';

  if v_client_id is null then
    return query select false, 'aplicacao_nao_configurada', null::text; return;
  end if;

  v_estado := encode(extensions.gen_random_bytes(24), 'hex');

  insert into privado.oauth_estados (estado, alvo, iniciado_por)
  values (v_estado, 'bling', auth.uid());

  -- Faxina barata: estado vencido não serve para nada e não precisa de cron.
  delete from privado.oauth_estados where expira_em < now() - interval '1 day';

  return query select
    true, 'ok',
    'https://www.bling.com.br/Api/v3/oauth/authorize'
      || '?response_type=code'
      || '&client_id=' || extensions.urlencode(v_client_id)
      || '&state=' || v_estado;
end;
$$;

comment on function public.iniciar_oauth_erp is
  'Cria o state e monta a URL de autorizacao do Bling. Sem redirect_uri: o Bling usa o endereco cadastrado no aplicativo.';

create or replace function public.desconectar_erp()
returns table (ok boolean, motivo text)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.e_admin() then
    return query select false, 'so_admin'; return;
  end if;

  update privado.credenciais_erp
     set access_token = null, refresh_token = null, expira_em = null,
         renovacao_erro = null, trava_ate = null, atualizado_em = now()
   where id;

  return query select true, 'ok';
end;
$$;

comment on function public.desconectar_erp is
  'Esquece o token do Bling. O aplicativo cadastrado continua; so a autorizacao cai.';

revoke all on function public.definir_aplicacao_erp(text, text) from public, anon;
revoke all on function public.erp_aplicacao_resumo() from public, anon;
revoke all on function public.iniciar_oauth_erp() from public, anon;
revoke all on function public.desconectar_erp() from public, anon;

grant execute on function public.definir_aplicacao_erp(text, text) to authenticated;
grant execute on function public.erp_aplicacao_resumo() to authenticated;
grant execute on function public.iniciar_oauth_erp() to authenticated;
grant execute on function public.desconectar_erp() to authenticated;
