-- `pacotes_na_doca` chamava `custo_etiqueta_em()` por linha. Isso amarra a
-- view à permissão de execução da função: quem pode ler as tabelas mas não
-- pode executá-la recebe permission denied na view inteira.
--
-- Troco a chamada por um lateral join direto na tabela de custos. Mesma
-- regra de vigência, sem dependência de GRANT de função — e uma chamada de
-- função a menos por linha.

-- `saidas_resumo` le de `pacotes_na_doca`, entao as tres caem e voltam juntas.
drop view if exists public.saidas_resumo;
drop view if exists public.doca_por_destino;
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
  coalesce(m.nome, 'nao classificada') as modalidade,
  m.tem_janela_coleta,
  ct.apelido         as conta,
  emp.nome_curto     as empresa,
  ed.codigo          as entrega_codigo,
  ed.entregue_por,
  ed.entregue_em,
  custo.valor        as custo_previsto
from public.pacotes pa
join public.entregas_doca_pacotes ep on ep.pacote_id = pa.id
join public.entregas_doca ed on ed.id = ep.entrega_id
join public.envios e on e.id = pa.envio_id
left join public.modalidades m on m.id = e.modalidade_id
join public.contas ct on ct.id = pa.conta_id
left join public.empresas emp on emp.id = ct.empresa_emissora_id
left join lateral (
  select ce.valor
  from public.custos_etiqueta ce
  where ce.modalidade_id = m.id
    and ce.vigente_de <= current_date
    and (ce.vigente_ate is null or ce.vigente_ate >= current_date)
  order by ce.vigente_de desc
  limit 1
) custo on true
where not exists (
  select 1 from public.saida_pacotes sp where sp.pacote_id = pa.id
);

comment on view public.pacotes_na_doca is
  'A aba Doca: entregue pela Expedicao, ainda dentro do galpao. Custo e previsto, nao contado.';

create view public.doca_por_destino
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

create view public.saidas_resumo
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
  (select count(*)::integer from public.pacotes_na_doca d
    where d.modalidade_id = s.modalidade_id) as na_doca
from public.saidas s
join public.modalidades m on m.id = s.modalidade_id
left join public.saida_pacotes sp on sp.saida_id = s.id
group by s.id, s.codigo, s.situacao, s.motorista, s.aberta_em,
         s.fechada_em, s.modalidade_id, m.nome;

comment on view public.saidas_resumo is
  'Saidas com pacotes e total ja somados, mais quantos ainda esperam na doca.';
