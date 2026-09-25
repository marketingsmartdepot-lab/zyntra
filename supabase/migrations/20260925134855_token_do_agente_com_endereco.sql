-- O token do agente era verificado rodando bcrypt contra TODA linha da tabela,
-- até achar a que casa. Duas consequências: a verificação fica mais cara a cada
-- impressora cadastrada, e — pior — as duas funções do agente são os únicos
-- endpoints do sistema que o `anon` pode chamar. Um endpoint sem login que faz
-- N bcrypts por requisição é amplificação barata para quem quiser derrubar a
-- fila de impressão do galpão.
--
-- O token passa a carregar o endereço junto: "<impressora>.<segredo>". A busca
-- vira uma leitura por chave primária e UM bcrypt, sempre. A parte pública não
-- é segredo nenhum — é o id de uma impressora — e o segredo continua com 192
-- bits e guardado só como hash.
--
-- Feito agora porque agora é de graça: não há nenhum agente cadastrado. Depois
-- custaria reinstalar o agente de cada bancada.

create or replace function privado.agente_da_credencial(p_token text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_impressora uuid;
begin
  -- Formato conferido antes de qualquer coisa: sem isto, um token torto faria
  -- o cast de uuid estourar e a função responderia com erro em vez de "não".
  if p_token !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9a-f]{48}$' then
    return null;
  end if;

  v_id := split_part(p_token, '.', 1)::uuid;

  select a.impressora_id into v_impressora
  from privado.agentes_impressao a
  where a.impressora_id = v_id
    and a.token_hash = extensions.crypt(split_part(p_token, '.', 2), a.token_hash);

  return v_impressora;
end;
$$;

comment on function privado.agente_da_credencial is
  'De qual impressora e este token. Uma leitura por chave e um bcrypt, em vez de um bcrypt por linha.';

create or replace function public.gerar_token_agente(p_impressora_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segredo text;
begin
  if not public.e_admin() then
    raise exception 'So administrador gera token de agente.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.impressoras i where i.id = p_impressora_id) then
    raise exception 'Impressora nao encontrada.' using errcode = 'no_data_found';
  end if;

  v_segredo := encode(extensions.gen_random_bytes(24), 'hex');

  insert into privado.agentes_impressao (impressora_id, token_hash, gerado_por)
  values (p_impressora_id, extensions.crypt(v_segredo, extensions.gen_salt('bf')), auth.uid())
  on conflict (impressora_id) do update
    set token_hash = excluded.token_hash,
        gerado_em = now(),
        gerado_por = excluded.gerado_por;

  -- Devolvido em claro UMA vez. Gerar de novo invalida o anterior.
  return p_impressora_id::text || '.' || v_segredo;
end;
$$;

comment on function public.gerar_token_agente is
  'Cria o token do agente e devolve em claro UMA vez. O token carrega o id da impressora antes do ponto; so o que vem depois e segredo.';

create or replace function public.agente_reservar_trabalhos(p_token text, p_limite integer default 5)
returns table (id uuid, tipo text, conteudo text, copias integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_impressora uuid;
begin
  v_impressora := privado.agente_da_credencial(p_token);
  if v_impressora is null then
    return;
  end if;

  update public.impressoras i
     set ultimo_contato_em = now()
   where i.id = v_impressora;

  return query
  update public.impressoes im
     set situacao = 'entregue_ao_agente',
         entregue_ao_agente_em = now(),
         tentativas = im.tentativas + 1
   where im.id in (
     select x.id from public.impressoes x
      where x.impressora_id = v_impressora
        and x.situacao = 'pendente'
        and x.conteudo is not null
      order by x.enviada_em
      limit greatest(p_limite, 1)
      for update skip locked
   )
  returning im.id, im.tipo::text, im.conteudo, im.copias;
end;
$$;

comment on function public.agente_reservar_trabalhos is
  'Entrega os proximos trabalhos daquela impressora e ja os marca. `for update skip locked` para dois agentes nao pegarem o mesmo.';

create or replace function public.agente_concluir_trabalho(
  p_token text,
  p_impressao_id uuid,
  p_ok boolean,
  p_erro text default null
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_impressora uuid;
begin
  v_impressora := privado.agente_da_credencial(p_token);
  if v_impressora is null then
    return query select false, 'token_invalido';
    return;
  end if;

  update public.impressoes im
     set situacao = case when p_ok then 'impressa' else 'erro' end,
         erro = case when p_ok then null else p_erro end
   where im.id = p_impressao_id
     and im.impressora_id = v_impressora;

  if not found then
    return query select false, 'trabalho_nao_encontrado';
    return;
  end if;

  return query select true, 'ok';
end;
$$;

comment on function public.agente_concluir_trabalho is
  'O agente diz se o papel saiu. `impressa` aqui e o comando aceito pela impressora - a prova fisica continua sendo o operador bipar a etiqueta.';

revoke all on function privado.agente_da_credencial(text) from public, anon, authenticated;

revoke all on function public.gerar_token_agente(uuid) from public, anon;
grant execute on function public.gerar_token_agente(uuid) to authenticated;

revoke all on function public.agente_reservar_trabalhos(text, integer) from public;
revoke all on function public.agente_concluir_trabalho(text, uuid, boolean, text) from public;
grant execute on function public.agente_reservar_trabalhos(text, integer) to anon, authenticated;
grant execute on function public.agente_concluir_trabalho(text, uuid, boolean, text) to anon, authenticated;
