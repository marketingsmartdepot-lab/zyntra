-- As duas colunas de permissão no operador de PIN ficaram sem leitor: agora
-- quem manda é a permissão do login. Coluna morta é armadilha — alguém marca e
-- acha que fez efeito.
--
-- A view `pessoas` deixa de costurar as permissões de dois lugares: são todas
-- do perfil agora. Quem só tem PIN aparece na lista sem permissão nenhuma, que
-- é a verdade: quem não entra no sistema não tem o que fazer nele.
drop view if exists public.pessoas;
drop view if exists public.operadores_situacao;

alter table public.operadores
  drop column if exists pode_reiniciar_conferencia,
  drop column if exists pode_bipar_por_sku;

create view public.pessoas
with (security_invoker = true)
as
  select
    p.id                                   as pessoa_id,
    p.id                                   as perfil_id,
    o.id                                   as operador_id,
    coalesce(nullif(btrim(p.nome), ''), p.email) as nome,
    p.email,
    p.papel::text                          as papel,
    p.ativo,
    p.criado_em,
    (exists (select 1 from public.equipe_autorizada a
              where lower(a.email) = lower(p.email)))  as autorizada,
    (o.id is not null)                     as na_bancada,
    coalesce(o.tem_pin, false)             as tem_pin,
    coalesce(o.bloqueado_ate is not null and o.bloqueado_ate > now(), false) as bloqueado,
    coalesce(o.tentativas_falhas, 0)       as tentativas_falhas,
    p.permissoes
  from public.perfis p
  left join public.operadores o on o.perfil_id = p.id

  union all

  select
    o.id, null::uuid, o.id,
    o.nome, null::text, o.papel::text, o.ativo, o.criado_em,
    false, true,
    o.tem_pin,
    (o.bloqueado_ate is not null and o.bloqueado_ate > now()),
    o.tentativas_falhas,
    '{}'::text[]
  from public.operadores o
  where o.perfil_id is null;

grant select on public.pessoas to authenticated;

create view public.operadores_situacao
with (security_invoker = true)
as
 SELECT id, nome, papel, ativo, tem_pin, tentativas_falhas, bloqueado_ate,
    bloqueado_ate IS NOT NULL AND bloqueado_ate > now() AS bloqueado,
    criado_em,
    ( SELECT se.estacao_id
           FROM sessoes_estacao se
          WHERE se.operador_id = o.id AND se.encerrada_em IS NULL
          ORDER BY se.iniciada_em DESC
         LIMIT 1) AS em_turno_na_estacao
   FROM operadores o;

grant select on public.operadores_situacao to authenticated;
