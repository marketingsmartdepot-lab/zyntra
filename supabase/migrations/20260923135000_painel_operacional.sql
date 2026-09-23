-- O painel operacional: volume por etapa, prazo apertado e o que travou.
--
-- Tudo derivado. Nenhum numero guardado em coluna: contador desatualiza e
-- passa a mentir, e painel que mente e pior que painel que nao existe.

create or replace view public.painel_volumes
with (security_invoker = true)
as
select
  pa.etapa::text as etapa,
  count(*)::integer as pacotes,
  coalesce(sum(pa.unidades_esperadas), 0)::integer as unidades
from public.pacotes pa
where pa.etapa <> 'encerrado'
group by pa.etapa;

comment on view public.painel_volumes is
  'Quantos pacotes em cada etapa da esteira.';

create or replace view public.painel_prazos
with (security_invoker = true)
as
select
  count(*) filter (where e.limite_envio_em < now())::integer as atrasados,
  count(*) filter (
    where e.limite_envio_em >= now()
      and e.limite_envio_em < now() + interval '2 hours'
  )::integer as vencendo_em_2h,
  count(*) filter (
    where e.limite_envio_em >= now() + interval '2 hours'
      and e.limite_envio_em < now() + interval '8 hours'
  )::integer as vencendo_hoje,
  count(*) filter (where e.limite_envio_em is null)::integer as sem_prazo,
  min(e.limite_envio_em) filter (where e.limite_envio_em >= now()) as proximo_limite
from public.pacotes pa
join public.envios e on e.id = pa.envio_id
where pa.etapa not in ('encerrado', 'pronto', 'retido');

comment on view public.painel_prazos is
  'Risco de atraso no que ainda esta na esteira. Pronto e retido ficam de fora: um ja saiu da corrida, o outro parou.';

-- Os pacotes mais apertados, para a tela mostrar quais sao e nao so quantos.
create or replace view public.painel_urgentes
with (security_invoker = true)
as
select
  pa.id,
  pa.etapa::text as etapa,
  e.limite_envio_em,
  coalesce(m.nome, 'nao classificada') as modalidade,
  ct.apelido as conta,
  (select p.ref_externa from public.pedidos p
    where p.envio_id = pa.envio_id order by p.criado_em limit 1) as codigo
from public.pacotes pa
join public.envios e on e.id = pa.envio_id
left join public.modalidades m on m.id = e.modalidade_id
join public.contas ct on ct.id = pa.conta_id
where pa.etapa not in ('encerrado', 'pronto', 'retido')
  and e.limite_envio_em is not null
order by e.limite_envio_em;

comment on view public.painel_urgentes is
  'Os pacotes ordenados por prazo. A tela corta nos primeiros.';

create or replace view public.painel_separacao
with (security_invoker = true)
as
select
  count(*) filter (where l.situacao = 'aguardando')::integer as listas_aguardando,
  count(*) filter (where l.situacao = 'em_execucao')::integer as listas_em_execucao,
  count(*) filter (
    where l.situacao = 'concluida'
      and l.concluida_em > now() - interval '24 hours'
  )::integer as listas_concluidas_24h
from public.listas_separacao l;

create or replace view public.painel_bancada
with (security_invoker = true)
as
select
  count(*) filter (where c.situacao = 'em_andamento')::integer as conferencias_abertas,
  (select count(*)::integer from public.divergencias d where d.liberada_em is null)
    as divergencias_abertas,
  (select count(*)::integer from public.impressoes im
    where im.situacao = 'pendente') as impressoes_na_fila,
  (select count(*)::integer from public.impressoras i
    where i.ativa
      and (i.ultimo_contato_em is null
           or i.ultimo_contato_em < now() - interval '2 minutes')) as agentes_offline
from public.conferencias c;

comment on view public.painel_bancada is
  'A saude da bancada: conferencias abertas, divergencias esperando lider e agente de impressao caido.';
