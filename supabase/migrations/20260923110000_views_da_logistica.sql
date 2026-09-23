-- Views da Logística, refeitas para servir a tela.
--
-- `pacotes_na_doca` devolvia `pacotes.*` e mais três colunas. O problema é que
-- o PostgREST não resolve relação aninhada a partir de view: a tela não
-- consegue pedir `envios(modalidades(nome))` como faz com tabela. Então a
-- view passa a trazer o que a tela mostra, já resolvido.

drop view if exists public.pacotes_na_doca;

create view public.pacotes_na_doca
with (security_invoker = true)
as
select
  pa.id,
  pa.etapa,
  pa.unidades_esperadas,
  e.ref_externa      as envio_ref,
  e.limite_envio_em,
  m.id               as modalidade_id,
  coalesce(m.nome, 'não classificada') as modalidade,
  m.tem_janela_coleta,
  ct.apelido         as conta,
  emp.nome_curto     as empresa,
  ed.codigo          as entrega_codigo,
  ed.entregue_por,
  ed.entregue_em,
  -- Previsto, não contado: o valor só vira custo quando o pacote é bipado na
  -- saída. Estar na doca ainda não é ter saído.
  public.custo_etiqueta_em(m.id) as custo_previsto
from public.pacotes pa
join public.entregas_doca_pacotes ep on ep.pacote_id = pa.id
join public.entregas_doca ed on ed.id = ep.entrega_id
join public.envios e on e.id = pa.envio_id
left join public.modalidades m on m.id = e.modalidade_id
join public.contas ct on ct.id = pa.conta_id
left join public.empresas emp on emp.id = ct.empresa_emissora_id
where not exists (
  select 1 from public.saida_pacotes sp where sp.pacote_id = pa.id
);

comment on view public.pacotes_na_doca is
  'A aba Doca: entregue pela Expedicao, ainda dentro do galpao. Custo e previsto, nao contado.';

-- Resumo das saídas, com contagem e total já somados. A tela de Estação de
-- saída precisa dos dois para mostrar progresso e acumulado.
create or replace view public.saidas_resumo
with (security_invoker = true)
as
select
  s.id,
  s.codigo,
  s.situacao,
  s.motorista,
  s.aberta_em,
  s.fechada_em,
  s.modalidade_id,
  m.nome as modalidade,
  count(sp.pacote_id)::integer as pacotes,
  coalesce(sum(sp.custo_etiqueta), 0)::numeric(12, 2) as total,
  -- Quantos ainda estão na doca esperando esta modalidade.
  (select count(*)::integer from public.pacotes_na_doca d
    where d.modalidade_id = s.modalidade_id) as na_doca
from public.saidas s
join public.modalidades m on m.id = s.modalidade_id
left join public.saida_pacotes sp on sp.saida_id = s.id
group by s.id, s.codigo, s.situacao, s.motorista, s.aberta_em,
         s.fechada_em, s.modalidade_id, m.nome;

comment on view public.saidas_resumo is
  'Saidas com pacotes e total ja somados, mais quantos ainda esperam na doca.';

-- A doca agrupada por destino: é o que a primeira tela da Logística mostra.
create or replace view public.doca_por_destino
with (security_invoker = true)
as
select
  d.modalidade_id,
  d.modalidade,
  d.tem_janela_coleta,
  count(*)::integer as pacotes,
  count(d.custo_previsto)::integer as pacotes_com_custo,
  coalesce(sum(d.custo_previsto), 0)::numeric(12, 2) as custo_previsto,
  min(d.entregue_em) as mais_antigo,
  min(d.limite_envio_em) as prazo_mais_apertado
from public.pacotes_na_doca d
group by d.modalidade_id, d.modalidade, d.tem_janela_coleta;

comment on view public.doca_por_destino is
  'Os grupos da aba Doca: coleta em domicilio, ponto de coleta e Flex.';
