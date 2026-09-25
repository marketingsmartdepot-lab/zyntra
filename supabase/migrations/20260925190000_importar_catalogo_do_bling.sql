-- Trazer os SKUs do Bling para o ZYNTRA.
--
-- A função antiga (casar_catalogo_erp) só ATUALIZAVA SKU que já existia. Com o
-- ZYNTRA começando vazio, ela não tinha o que casar — rodar devolvia "0" e
-- pronto. Esta cria o que falta.
--
-- Escrita contra a resposta real da API, não contra suposição: os campos são
-- `codigo`, `nome`, `situacao`, `id` e `imagemURL`, e `situacao = 'A'` é o
-- ativo. Conferido em /Api/v3/produtos com o token da conta antes de escrever,
-- porque já errei duas vezes hoje adivinhando contrato do Bling.
--
-- Sem tabela temporária: `create temp table ... on commit drop` estoura na
-- segunda chamada dentro da mesma transação, e importar catálogo é exatamente
-- chamar a função uma vez por página.

create or replace function public.importar_catalogo_erp(p_produtos jsonb)
returns table (
  criados integer, casados integer, ja_estavam integer, inativos integer,
  sem_codigo integer, fotos integer, codigos_repetidos text[]
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_entrada jsonb; v_limpa jsonb; v_repetidos text[] := '{}';
  v_criados integer := 0; v_casados integer := 0; v_iguais integer := 0;
  v_inativos integer := 0; v_sem_codigo integer := 0; v_fotos integer := 0;
begin
  if not public.e_admin() then
    raise exception 'So administrador importa o catalogo.'
      using errcode = 'insufficient_privilege';
  end if;

  -- O código vira maiúsculo porque é por ele que o casamento acontece, e
  -- "dc09-100" e "DC09-100" são o mesmo produto.
  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', upper(btrim(coalesce(x->>'codigo',''))),
           'erp_ref', btrim(coalesce(x->>'id','')),
           'nome', btrim(coalesce(x->>'nome','')),
           'situacao', upper(btrim(coalesce(x->>'situacao',''))),
           'foto', nullif(btrim(coalesce(x->>'foto','')), '')
         )), '[]'::jsonb)
    into v_entrada
  from jsonb_array_elements(coalesce(p_produtos, '[]'::jsonb)) x;

  select count(*) into v_inativos
  from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, nome text, situacao text, foto text)
  where e.situacao <> 'A';

  select count(*) into v_sem_codigo
  from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, nome text, situacao text, foto text)
  where e.situacao = 'A' and (e.codigo = '' or e.erp_ref = '');

  -- Código repetido na origem fica de fora: casar com "algum" deles daria
  -- baixa no produto errado para sempre.
  select coalesce(array_agg(codigo), '{}') into v_repetidos
  from (
    select e.codigo
    from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, nome text, situacao text, foto text)
    where e.situacao = 'A' and e.codigo <> '' and e.erp_ref <> ''
    group by e.codigo having count(distinct e.erp_ref) > 1
  ) d;

  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_limpa
  from (
    select distinct on (e.codigo) e.codigo, e.erp_ref, e.nome, e.foto
    from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, nome text, situacao text, foto text)
    where e.situacao = 'A' and e.codigo <> '' and e.erp_ref <> '' and e.nome <> ''
      and not (e.codigo = any(v_repetidos))
    order by e.codigo, e.erp_ref
  ) f;

  select count(*) filter (where s.erp_ref is not distinct from e.erp_ref),
         count(*) filter (where s.erp_ref is distinct from e.erp_ref)
    into v_iguais, v_casados
  from public.skus s
  join jsonb_to_recordset(v_limpa) as e(codigo text, erp_ref text, nome text, foto text)
    on upper(btrim(s.codigo)) = e.codigo;

  select count(*) into v_criados
  from jsonb_to_recordset(v_limpa) as e(codigo text, erp_ref text, nome text, foto text)
  where not exists (select 1 from public.skus s where upper(btrim(s.codigo)) = e.codigo);

  insert into public.skus (codigo, descricao, erp_ref, foto_url, ativo, sincronizado_em)
  select e.codigo, e.nome, e.erp_ref, e.foto, true, now()
  from jsonb_to_recordset(v_limpa) as e(codigo text, erp_ref text, nome text, foto text)
  on conflict (codigo) do update
    set erp_ref = excluded.erp_ref,
        -- A descrição NÃO é sobrescrita: se alguém ajustou o nome aqui para a
        -- bancada entender, a importação não desfaz isso.
        foto_url = coalesce(nullif(public.skus.foto_url, ''), excluded.foto_url),
        sincronizado_em = now(), atualizado_em = now();

  select count(*) into v_fotos
  from public.skus s
  join jsonb_to_recordset(v_limpa) as e(codigo text, erp_ref text, nome text, foto text)
    on upper(btrim(s.codigo)) = e.codigo
  where coalesce(s.foto_url,'') <> '' and e.foto is not null;

  return query select v_criados, v_casados, v_iguais, v_inativos,
                      v_sem_codigo, v_fotos, v_repetidos;
end;
$$;

comment on function public.importar_catalogo_erp is
  'Cria o SKU que nao existe e casa o que existe, a partir de uma pagina de produtos do Bling. So situacao=A. Reentrante.';

revoke all on function public.importar_catalogo_erp(jsonb) from public, anon;
grant execute on function public.importar_catalogo_erp(jsonb) to authenticated;
