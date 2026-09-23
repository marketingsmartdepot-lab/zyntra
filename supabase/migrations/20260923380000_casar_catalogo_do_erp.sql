-- Casa o catalogo do Bling com os SKUs daqui, pelo codigo.
--
-- A logica de casamento fica no banco de proposito: ela e a parte que se pode
-- provar. Quem busca no Bling e so transporte, e vive numa Edge Function.
--
-- A funcao e REENTRANTE porque a sincronizacao faz uma chamada por pagina do
-- catalogo. (A primeira versao usava tabela temporaria `on commit drop`, que
-- nao some entre duas chamadas na mesma transacao — bastava alguem agrupar
-- duas paginas para a segunda estourar.)
--
-- Duas armadilhas tratadas, porque as duas dao erro silencioso:
--
-- 1. Codigo repetido na origem. Casar com "algum" deles daria baixa no produto
--    errado para sempre. Esses ficam de fora e sao relatados.
-- 2. Referencia que muda. A coluna e atualizada, mas o retorno diz quantas
--    mudaram — isso nao deveria acontecer em operacao normal.

create or replace function public.casar_catalogo_erp(p_produtos jsonb)
returns table (
  casados integer,
  ja_estavam integer,
  mudaram integer,
  codigos_repetidos text[],
  sem_codigo integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entrada jsonb;
  v_casados integer := 0;
  v_iguais integer := 0;
  v_mudaram integer := 0;
  v_repetidos text[] := '{}';
  v_sem_codigo integer := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', upper(trim(x->>'codigo')),
           'erp_ref', trim(x->>'id')
         )), '[]'::jsonb)
    into v_entrada
  from jsonb_array_elements(coalesce(p_produtos, '[]'::jsonb)) x;

  select count(*) into v_sem_codigo
  from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text)
  where coalesce(e.codigo, '') = '' or coalesce(e.erp_ref, '') = '';

  select coalesce(array_agg(codigo), '{}') into v_repetidos
  from (
    select e.codigo
    from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text)
    where coalesce(e.codigo, '') <> '' and coalesce(e.erp_ref, '') <> ''
    group by e.codigo
    having count(distinct e.erp_ref) > 1
  ) d;

  -- Quantos ja estavam certos e quantos mudam, medido antes de escrever.
  select
    count(*) filter (where s.erp_ref is not distinct from e.erp_ref),
    count(*) filter (where s.erp_ref is not null and s.erp_ref is distinct from e.erp_ref)
  into v_iguais, v_mudaram
  from public.skus s
  join jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text)
    on upper(trim(s.codigo)) = e.codigo
  where coalesce(e.codigo, '') <> ''
    and coalesce(e.erp_ref, '') <> ''
    and not (e.codigo = any(v_repetidos));

  update public.skus s
     set erp_ref = e.erp_ref,
         sincronizado_em = now()
  from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text)
  where upper(trim(s.codigo)) = e.codigo
    and coalesce(e.codigo, '') <> ''
    and coalesce(e.erp_ref, '') <> ''
    and not (e.codigo = any(v_repetidos))
    and s.erp_ref is distinct from e.erp_ref;

  get diagnostics v_casados = row_count;

  return query select v_casados, v_iguais, v_mudaram, v_repetidos, v_sem_codigo;
end;
$$;

comment on function public.casar_catalogo_erp is
  'Casa produtos do ERP com os SKUs pelo codigo. Reentrante: uma chamada por pagina do catalogo. Codigo repetido na origem fica de fora e e relatado.';

/**
 * O que ainda nao casou, do nosso lado.
 *
 * E a lista acionavel: cada um destes e uma baixa que vai falhar dizendo "SKU
 * sem referencia no Bling". Produtos que existem no Bling e nao existem aqui
 * nao aparecem — nao vendemos o que nao esta no catalogo daqui.
 */
create or replace view public.skus_sem_erp
with (security_invoker = true)
as
select
  s.id,
  s.codigo,
  s.descricao,
  s.sincronizado_em,
  exists (
    select 1 from public.mapeamentos_anuncio m where m.sku_id = s.id
  ) as tem_anuncio
from public.skus s
where s.ativo and coalesce(s.erp_ref, '') = '';

comment on view public.skus_sem_erp is
  'SKUs ativos sem referencia no ERP. Cada um destes e uma baixa que vai falhar.';

revoke execute on function public.casar_catalogo_erp(jsonb) from public, anon, authenticated;
