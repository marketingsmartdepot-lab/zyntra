-- Onde caem os avisos do Mercado Livre.
--
-- O ML avisa e não repete para sempre: se a resposta demora ou falha, ele
-- reenvia algumas vezes e desiste. Como a entrada de pedidos ainda não existe,
-- o aviso é guardado CRU agora para ser processado depois — senão as primeiras
-- semanas de venda entrariam no sistema sem histórico nenhum.
--
-- A rota que recebe isto é pública por obrigação: o Mercado Livre não tem
-- login no ZYNTRA. O que faz as vezes de porta é o `application_id`, que só o
-- nosso aplicativo manda, e o fato de a função só saber inserir.

create table if not exists privado.avisos_ml (
  id            bigint generated always as identity primary key,
  topico        text,
  recurso       text,
  user_id       text,
  aplicacao     text,
  tentativas    integer,
  enviado_em    timestamptz,
  recebido_em   timestamptz not null default now(),
  processado_em timestamptz,
  corpo         jsonb not null
);

-- O ML reenvia o MESMO aviso enquanto não recebe 200. Sem isto, uma
-- lentidão de dez segundos viraria dez linhas do mesmo pedido.
create unique index if not exists avisos_ml_unico
  on privado.avisos_ml (topico, recurso, enviado_em);

create index if not exists avisos_ml_pendentes
  on privado.avisos_ml (recebido_em) where processado_em is null;

/**
 * Recebe um aviso do Mercado Livre.
 *
 * Aberta ao público sem sessão, porque quem chama é o ML. Por isso ela só faz
 * uma coisa: inserir. Não lê nada, não devolve nada de dentro do banco, e
 * recusa aviso que não venha do nosso aplicativo.
 */
create or replace function public.receber_aviso_ml(p_corpo jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_client_id text;
  v_aplicacao text;
begin
  select a.client_id into v_client_id
  from privado.aplicacoes a where a.alvo = 'mercado_livre';

  v_aplicacao := coalesce(p_corpo->>'application_id', '');

  if v_client_id is null or v_aplicacao <> v_client_id then
    return false;
  end if;

  insert into privado.avisos_ml
    (topico, recurso, user_id, aplicacao, tentativas, enviado_em, corpo)
  values (
    p_corpo->>'topic',
    p_corpo->>'resource',
    p_corpo->>'user_id',
    v_aplicacao,
    nullif(p_corpo->>'attempts', '')::integer,
    nullif(p_corpo->>'sent', '')::timestamptz,
    p_corpo)
  on conflict (topico, recurso, enviado_em) do nothing;

  return true;
end;
$$;

revoke all on function public.receber_aviso_ml(jsonb) from public;
grant execute on function public.receber_aviso_ml(jsonb) to anon, authenticated;

revoke all on table privado.avisos_ml from anon, authenticated;
