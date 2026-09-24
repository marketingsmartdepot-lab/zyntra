-- A sincronizacao do catalogo passa a trazer a foto do produto.
--
-- Sem isto, o detalhe do pedido mostraria caixa vazia para sempre: a foto do
-- anuncio so vem com a sincronizacao do canal, que depende das credenciais do
-- ML. A do ERP e o que da para ter antes.
--
-- So preenche quando esta VAZIA. Foto que alguem colocou a mao nao e
-- sobrescrita por uma sincronizacao automatica — quem mexeu tinha motivo.
--
-- O campo e opcional: se o Bling nao devolver imagem na listagem, nada muda e
-- nada quebra.

drop function if exists public.casar_catalogo_erp(jsonb);

create or replace function public.casar_catalogo_erp(p_produtos jsonb)
returns table (
  casados integer,
  ja_estavam integer,
  mudaram integer,
  codigos_repetidos text[],
  sem_codigo integer,
  fotos integer
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
  v_fotos integer := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', upper(trim(x->>'codigo')),
           'erp_ref', trim(x->>'id'),
           'foto', nullif(trim(coalesce(x->>'foto', '')), '')
         )), '[]'::jsonb)
    into v_entrada
  from jsonb_array_elements(coalesce(p_produtos, '[]'::jsonb)) x;

  select count(*) into v_sem_codigo
  from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, foto text)
  where coalesce(e.codigo, '') = '' or coalesce(e.erp_ref, '') = '';

  -- Codigo repetido na origem: casar com "algum" deles daria baixa no produto
  -- errado para sempre.
  select coalesce(array_agg(codigo), '{}') into v_repetidos
  from (
    select e.codigo
    from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, foto text)
    where coalesce(e.codigo, '') <> '' and coalesce(e.erp_ref, '') <> ''
    group by e.codigo
    having count(distinct e.erp_ref) > 1
  ) d;

  select
    count(*) filter (where s.erp_ref is not distinct from e.erp_ref),
    count(*) filter (where s.erp_ref is not null and s.erp_ref is distinct from e.erp_ref)
  into v_iguais, v_mudaram
  from public.skus s
  join jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, foto text)
    on upper(trim(s.codigo)) = e.codigo
  where coalesce(e.codigo, '') <> ''
    and coalesce(e.erp_ref, '') <> ''
    and not (e.codigo = any(v_repetidos));

  update public.skus s
     set erp_ref = e.erp_ref,
         sincronizado_em = now()
  from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, foto text)
  where upper(trim(s.codigo)) = e.codigo
    and coalesce(e.codigo, '') <> ''
    and coalesce(e.erp_ref, '') <> ''
    and not (e.codigo = any(v_repetidos))
    and s.erp_ref is distinct from e.erp_ref;

  get diagnostics v_casados = row_count;

  -- A foto so entra onde nao ha nenhuma.
  update public.skus s
     set foto_url = e.foto
  from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, foto text)
  where upper(trim(s.codigo)) = e.codigo
    and coalesce(e.codigo, '') <> ''
    and coalesce(e.foto, '') <> ''
    and not (e.codigo = any(v_repetidos))
    and coalesce(s.foto_url, '') = '';

  get diagnostics v_fotos = row_count;

  return query select v_casados, v_iguais, v_mudaram, v_repetidos, v_sem_codigo, v_fotos;
end;
$$;

comment on function public.casar_catalogo_erp is
  'Casa produtos do ERP com os SKUs pelo codigo e traz a foto quando houver. Reentrante. Codigo repetido na origem fica de fora e e relatado.';

revoke execute on function public.casar_catalogo_erp(jsonb) from public, anon, authenticated;
