-- A fila que o agente da bancada consome.
--
-- O conteudo ZPL fica guardado aqui, ja resolvido pelo servidor. O agente nao
-- fala com o Mercado Livre: quem busca a etiqueta e o lado servidor, que tem
-- o token. O agente so recebe texto e manda para a impressora — assim o
-- segredo nunca sai da maquina errada.

alter table public.impressoes
  add column if not exists conteudo text,
  add column if not exists copias integer not null default 1 check (copias > 0),
  add column if not exists tentativas integer not null default 0;

comment on column public.impressoes.conteudo is
  'ZPL pronto. O agente nao busca nada: recebe texto e imprime.';

-- O agente reserva o que vai imprimir. E mutacao de proposito: dois agentes
-- nao podem pegar o mesmo trabalho.
create or replace function public.agente_reservar_trabalhos(
  p_token text,
  p_limite integer default 5
)
returns table (id uuid, tipo text, conteudo text, copias integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_impressora uuid;
begin
  select a.impressora_id into v_impressora
  from privado.agentes_impressao a
  where a.token_hash = extensions.crypt(p_token, a.token_hash);

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
  select a.impressora_id into v_impressora
  from privado.agentes_impressao a
  where a.token_hash = extensions.crypt(p_token, a.token_hash);

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

revoke all on function public.agente_reservar_trabalhos(text, integer) from public;
revoke all on function public.agente_concluir_trabalho(text, uuid, boolean, text) from public;
grant execute on function public.agente_reservar_trabalhos(text, integer) to anon, authenticated;
grant execute on function public.agente_concluir_trabalho(text, uuid, boolean, text) to anon, authenticated;
