-- A Daniele perguntou se o nome de quem separou fica na lista. Fica — mas no
-- filtro da Expedicao ele nunca apareceu, e a chave estrangeira prova o
-- porque:
--
--   listas_separacao.separador_id  ->  REFERENCES operadores(id)
--
-- O separador e gravado por `somar_na_separacao` a partir do PIN de quem
-- bipou. Certo. Mas `valores_para_filtro` procurava esse id em `perfis`.
--
-- `perfis` e `operadores` sao tabelas de gente diferente: o perfil e de quem
-- tem login, o operador e de quem tem PIN. Um id de operador nunca casa em
-- `perfis`, entao o join devolvia nulo SEMPRE, e a lista aparecia sem nome.
--
-- Nao dava erro em lugar nenhum. So nao aparecia — que e como defeito de
-- rastreabilidade costuma se esconder: ninguem procura o nome ate o dia em
-- que uma caixa some, e ai a informacao que faltava era justamente essa.

create or replace function public.valores_para_filtro(p_etapa public.etapa)
returns table (coluna text, valor text, rotulo text, quantos integer)
language sql
stable
security definer
set search_path to ''
as $function$
  with base as (
    select pa.id, pa.conta_id, e.modalidade_id,
           e.etiqueta_conteudo is not null as tem_etiqueta,
           coalesce((select nf.situacao::text from public.notas_fiscais nf
                      where nf.pacote_id = pa.id
                      order by nf.atualizado_em desc limit 1), 'sem') as nf,
           (select lp.lista_id from public.listas_pacotes lp
             where lp.pacote_id = pa.id
             order by lp.adicionado_em desc limit 1) as lista_id
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    where public.e_da_equipe() and pa.etapa = p_etapa
  )
  select 'conta', b.conta_id::text, ct.apelido, count(*)::int
    from base b join public.contas ct on ct.id = b.conta_id
   group by 1,2,3
  union all
  select 'modalidade', b.modalidade_id::text, m.nome, count(*)::int
    from base b join public.modalidades m on m.id = b.modalidade_id
   group by 1,2,3
  union all
  select 'nf', b.nf,
         case b.nf when 'sem' then 'Sem nota'
                   when 'autorizada' then 'Autorizada'
                   when 'rejeitada' then 'Rejeitada'
                   when 'cancelada' then 'Cancelada'
                   when 'solicitada' then 'Solicitada'
                   else b.nf end,
         count(*)::int
    from base b group by 1,2,3
  union all
  select 'etiqueta',
         case when b.tem_etiqueta then 'obtida' else 'pendente' end,
         case when b.tem_etiqueta then 'Obtida' else 'Pendente' end,
         count(*)::int
    from base b group by 1,2,3
  union all
  select 'separacao',
         coalesce(b.lista_id::text, 'sem'),
         coalesce(ls.codigo || coalesce(' · ' || o.nome, ''), 'Sem lista'),
         count(*)::int
    from base b
    left join public.listas_separacao ls on ls.id = b.lista_id
    -- `operadores`, e nao `perfis`: e para la que a chave estrangeira de
    -- `separador_id` aponta.
    left join public.operadores o on o.id = ls.separador_id
   group by 1,2,3
  order by 1, 3;
$function$;

comment on function public.valores_para_filtro is
  'Os valores que cada filtro de coluna oferece na Expedicao. O separador sai '
  'de `operadores` — a chave estrangeira de separador_id aponta para la.';
