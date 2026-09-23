-- A aba Aberto agrupada por CAUSA, nao por pedido.
--
-- Um NCM faltando trava trinta pedidos. Listados um a um, o time resolve o
-- mesmo problema trinta vezes. Agrupados por causa, corrige uma vez e libera
-- os trinta.
--
-- As causas vem de duas fontes que o operador nao precisa distinguir: o
-- bloqueio que a esteira registrou e a rejeicao que o Mercado Livre devolveu.

create or replace view public.aberto_por_causa
with (security_invoker = true)
as
with bloqueios_abertos as (
  select
    'bloqueio'::text                as fonte,
    b.tipo::text                    as tipo,
    null::text                      as codigo,
    coalesce(b.causa, b.tipo::text) as causa,
    b.detalhe                       as detalhe,
    null::text                      as campo_a_corrigir,
    pa.id                           as pacote_id,
    ct.apelido                      as conta,
    b.aberto_em                     as em
  from public.bloqueios b
  join public.pacotes pa on pa.id = b.pacote_id
  join public.contas ct on ct.id = pa.conta_id
  where b.resolvido_em is null
    and pa.etapa = 'aberto'
),
rejeicoes as (
  select
    'nota'::text                       as fonte,
    'rejeicao_fiscal'::text            as tipo,
    nf.erro_codigo                     as codigo,
    coalesce(nf.erro_mensagem, 'Rejeicao sem mensagem') as causa,
    nf.erro_mensagem                   as detalhe,
    nf.campo_a_corrigir                as campo_a_corrigir,
    pa.id                              as pacote_id,
    ct.apelido                         as conta,
    nf.atualizado_em                   as em
  from public.notas_fiscais nf
  join public.pacotes pa on pa.id = nf.pacote_id
  join public.contas ct on ct.id = pa.conta_id
  where nf.situacao = 'rejeitada'
    and pa.etapa = 'aberto'
),
tudo as (
  select * from bloqueios_abertos
  union all
  select * from rejeicoes
)
select
  fonte,
  tipo,
  codigo,
  causa,
  max(detalhe)                            as detalhe,
  max(campo_a_corrigir)                   as campo_a_corrigir,
  count(distinct pacote_id)::integer      as pacotes,
  array_agg(distinct conta order by conta) as contas,
  min(em)                                 as primeira_ocorrencia,
  max(em)                                 as ultima_ocorrencia
from tudo
group by fonte, tipo, codigo, causa;

comment on view public.aberto_por_causa is
  'A aba Aberto: uma linha por causa, com quantos pedidos ela trava e em quais contas.';

-- Contas com a emissao automatica pausada pelo disjuntor. Aparece como aviso
-- no topo da aba, porque e a causa que trava contas inteiras de uma vez.
create or replace view public.emissao_pausada
with (security_invoker = true)
as
select
  c.id,
  c.apelido,
  c.emissao_pausada_em,
  c.emissao_pausa_motivo,
  e.nome_curto as empresa
from public.contas c
left join public.empresas e on e.id = c.empresa_emissora_id
where c.emissao_pausada_em is not null;

comment on view public.emissao_pausada is
  'Contas com o disjuntor da emissao automatica acionado.';
