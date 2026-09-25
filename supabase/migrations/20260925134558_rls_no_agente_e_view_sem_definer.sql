-- Duas sobras da varredura.

-- 1. A tabela do token do agente era a única do schema privado sem RLS ligado.
-- Não era porta aberta — o schema privado não tem grant nenhum para anon nem
-- para authenticated, e nem USAGE, então a API REST não o alcança de forma
-- alguma. Mas é a tabela que guarda o hash do token das impressoras, e ser a
-- única irmã sem a tranca é o tipo de assimetria que um dia alguém copia para
-- o lado errado.
alter table privado.agentes_impressao enable row level security;

comment on table privado.agentes_impressao is
  'Token do agente de impressao, em bcrypt. RLS ligado e sem politica: ninguem le pela API, so as funcoes SECURITY DEFINER do agente alcancam.';

-- 2. operadores_situacao só precisava de SECURITY DEFINER por um motivo: ela
-- calculava `tem_pin` lendo o pin_hash, e a leitura dessa coluna é revogada.
-- Guardando o "tem PIN" como fato próprio, a view para de tocar no segredo e
-- pode rodar como o usuário comum — e o RLS de operadores passa a valer para
-- ela como vale para todo o resto. Uma view definer a menos no sistema.
alter table public.operadores
  add column if not exists tem_pin boolean not null default false;

update public.operadores set tem_pin = (pin_hash is not null);

create or replace function public.sincronizar_tem_pin()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.tem_pin := new.pin_hash is not null;
  return new;
end;
$$;

drop trigger if exists operadores_tem_pin on public.operadores;
create trigger operadores_tem_pin
  before insert or update on public.operadores
  for each row execute function public.sincronizar_tem_pin();

comment on column public.operadores.tem_pin is
  'Espelho de "pin_hash is not null", mantido por gatilho. Existe para a tela saber se falta PIN sem que ninguem precise de acesso ao hash.';

-- Ninguém escreve isto a mão: é o gatilho que decide, a partir do pin_hash.
revoke insert (tem_pin), update (tem_pin) on public.operadores from authenticated;
grant select (tem_pin) on public.operadores to authenticated;

-- Agora a view não toca mais no pin_hash e pode ser invoker. O `where` sai
-- junto: como invoker, quem filtra é a política da tabela, e repetir a checagem
-- aqui só faria o trabalho duas vezes.
drop view if exists public.operadores_situacao;

create view public.operadores_situacao
with (security_invoker = true)
as
select
  o.id,
  o.nome,
  o.papel,
  o.ativo,
  o.tem_pin,
  o.tentativas_falhas,
  o.bloqueado_ate,
  ((o.bloqueado_ate is not null) and (o.bloqueado_ate > now())) as bloqueado,
  o.criado_em,
  (select se.estacao_id
     from public.sessoes_estacao se
    where se.operador_id = o.id and se.encerrada_em is null
    order by se.iniciada_em desc
    limit 1) as em_turno_na_estacao
from public.operadores o;

comment on view public.operadores_situacao is
  'Situacao dos operadores. Roda como o usuario que pergunta: o RLS de operadores filtra, e o pin_hash nunca e tocado.';

revoke all on public.operadores_situacao from anon;
grant select on public.operadores_situacao to authenticated;
