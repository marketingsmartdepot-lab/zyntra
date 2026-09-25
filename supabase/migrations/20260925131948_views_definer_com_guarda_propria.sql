-- Corrigindo a correção. Eu tinha trocado estas duas para security_invoker, o
-- que quebrou as duas: elas PRECISAM de permissão elevada. operadores_situacao
-- lê a tabela de operadores, cujo grant foi revogado coluna a coluna por causa
-- do pin_hash; saude_das_conexoes lê o schema privado, onde moram os tokens.
--
-- O padrão certo para uma view assim não é abrir mão do definer — é o definer
-- checar sozinho quem está perguntando. Assim ela continua alcançando o dado
-- que precisa, sem expor segredo e sem servir de porta dos fundos.

alter view public.operadores_situacao set (security_invoker = false);
alter view public.saude_das_conexoes set (security_invoker = false);

create or replace view public.operadores_situacao as
select
  o.id,
  o.nome,
  o.papel,
  o.ativo,
  (o.pin_hash is not null) as tem_pin,
  o.tentativas_falhas,
  o.bloqueado_ate,
  ((o.bloqueado_ate is not null) and (o.bloqueado_ate > now())) as bloqueado,
  o.criado_em,
  (select se.estacao_id
     from public.sessoes_estacao se
    where se.operador_id = o.id and se.encerrada_em is null
    order by se.iniciada_em desc
    limit 1) as em_turno_na_estacao
from public.operadores o
where (select public.e_da_equipe());

comment on view public.operadores_situacao is
  'Situacao dos operadores sem jamais expor o pin_hash, so se existe. Roda como definer porque o grant da tabela foi revogado por causa do PIN, e por isso checa e_da_equipe() sozinha.';

create or replace view public.saude_das_conexoes as
select
  ct.id as conta_id,
  ct.apelido,
  'mercado_livre'::text as alvo,
  (c.access_token is not null) as conectada,
  c.expira_em,
  ((c.expira_em is not null) and (c.expira_em < now())) as expirada,
  c.renovado_em,
  c.renovacoes,
  c.renovacao_erro
from public.contas ct
left join privado.credenciais_conta c on c.conta_id = ct.id
where (select public.e_da_equipe())

union all

select
  null::uuid as conta_id,
  'Bling'::text as apelido,
  'bling'::text as alvo,
  (e.access_token is not null) as conectada,
  e.expira_em,
  ((e.expira_em is not null) and (e.expira_em < now())) as expirada,
  e.renovado_em,
  e.renovacoes,
  e.renovacao_erro
from privado.credenciais_erp e
where (select public.e_da_equipe());

comment on view public.saude_das_conexoes is
  'Se a conexao esta viva e quando expira — nunca o token. Roda como definer porque le o schema privado, e por isso checa e_da_equipe() sozinha.';
