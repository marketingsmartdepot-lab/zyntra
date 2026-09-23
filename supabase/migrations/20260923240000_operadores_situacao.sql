-- A tela precisa saber SE o operador tem PIN, nao qual e.
--
-- Como `pin_hash` deixou de ser legivel, a resposta vem por uma view que
-- devolve so o booleano. Ela roda como dona (nao e security_invoker) para
-- conseguir olhar a coluna — e por isso devolve exclusivamente o fato, nunca
-- o hash. Mesmo desenho de `impressoras.token_gerado_em`: o schema publico
-- guarda o FATO de existir segredo, nunca o segredo.
--
-- Nao se perde filtro de RLS nisso: a politica de leitura de `operadores` e
-- `using (true)`, entao nao havia nada a filtrar.

create or replace view public.operadores_situacao as
select
  o.id,
  o.nome,
  o.papel,
  o.ativo,
  (o.pin_hash is not null) as tem_pin,
  o.tentativas_falhas,
  o.bloqueado_ate,
  (o.bloqueado_ate is not null and o.bloqueado_ate > now()) as bloqueado,
  o.criado_em,
  (select se.estacao_id from public.sessoes_estacao se
    where se.operador_id = o.id and se.encerrada_em is null
    order by se.iniciada_em desc limit 1) as em_turno_na_estacao
from public.operadores o;

comment on view public.operadores_situacao is
  'Operadores para a tela: diz SE tem PIN, nunca qual. E em qual bancada cada um esta em turno.';

grant select on public.operadores_situacao to authenticated;

-- Quem esta em turno agora, por bancada.
create or replace view public.turnos_abertos as
select
  se.id,
  se.estacao_id,
  e.nome as estacao,
  se.operador_id,
  o.nome as operador,
  o.papel,
  se.iniciada_em
from public.sessoes_estacao se
join public.estacoes e on e.id = se.estacao_id
join public.operadores o on o.id = se.operador_id
where se.encerrada_em is null;

comment on view public.turnos_abertos is
  'O turno aberto de cada bancada. Uma bancada tem no maximo um: abrir turno encerra o anterior.';

grant select on public.turnos_abertos to authenticated;
