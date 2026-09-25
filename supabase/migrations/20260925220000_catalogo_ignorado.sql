-- Apagar sozinho não resolve: o produto continua ativo no Bling e a próxima
-- sincronização o traz de volta. Limpar viraria trabalho de todo dia.
--
-- Então apagar também anota: o código entra numa lista de ignorados, e a
-- importação passa a pular quem está nela. Limpa uma vez e fica limpo.

create table if not exists public.catalogo_ignorado (
  codigo text primary key,
  erp_ref text,
  descricao text,
  ignorado_por uuid references public.perfis (id) on delete set null,
  criado_em timestamptz not null default now()
);

comment on table public.catalogo_ignorado is
  'Produtos que a administracao apagou e nao quer de volta. A importacao pula estes codigos, senao a sincronizacao seguinte recriaria tudo.';

alter table public.catalogo_ignorado enable row level security;

drop policy if exists "equipe le ignorados" on public.catalogo_ignorado;
create policy "equipe le ignorados" on public.catalogo_ignorado
  for select to authenticated using ((select public.e_da_equipe()));

revoke all on table public.catalogo_ignorado from anon, authenticated;
grant select on table public.catalogo_ignorado to authenticated;

-- --------------------------------- apagar passa a anotar

create or replace function public.excluir_skus(p_ids uuid[])
returns table (ok boolean, motivo text, apagados integer, bloqueados jsonb)
language plpgsql security definer set search_path = ''
as $$
declare v_n integer; v_bloqueados jsonb;
begin
  if coalesce(public.papel_atual()::text,'') not in ('lider','admin') then
    return query select false, 'sem_permissao', 0, null::jsonb; return;
  end if;

  if p_ids is null or array_length(p_ids,1) is null then
    return query select false, 'nada_selecionado', 0, null::jsonb; return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'motivo', x.motivo)), '[]'::jsonb)
    into v_bloqueados
  from (
    select s.codigo,
           case
             when exists (select 1 from public.conferencia_itens i where i.sku_id = s.id)
               then 'ja passou por uma conferencia'
             when exists (select 1 from public.baixas_estoque_itens i where i.sku_id = s.id)
               then 'ja teve baixa de estoque'
             when exists (select 1 from public.mapeamentos_anuncio m where m.sku_id = s.id)
               then 'esta ligado a um anuncio'
             when exists (select 1 from public.sku_componentes c where c.componente_id = s.id)
               then 'e componente de um kit'
           end as motivo
    from public.skus s where s.id = any(p_ids)
  ) x
  where x.motivo is not null;

  -- Anota ANTES de apagar: depois do delete o código não existe mais para ser
  -- anotado, e a sincronização seguinte traria tudo de volta.
  insert into public.catalogo_ignorado (codigo, erp_ref, descricao, ignorado_por)
  select s.codigo, s.erp_ref, s.descricao, auth.uid()
  from public.skus s
  where s.id = any(p_ids)
    and not exists (select 1 from public.conferencia_itens i where i.sku_id = s.id)
    and not exists (select 1 from public.baixas_estoque_itens i where i.sku_id = s.id)
    and not exists (select 1 from public.mapeamentos_anuncio m where m.sku_id = s.id)
    and not exists (select 1 from public.sku_componentes c where c.componente_id = s.id)
  on conflict (codigo) do update
    set erp_ref = excluded.erp_ref, descricao = excluded.descricao, criado_em = now();

  delete from public.skus s
   where s.id = any(p_ids)
     and not exists (select 1 from public.conferencia_itens i where i.sku_id = s.id)
     and not exists (select 1 from public.baixas_estoque_itens i where i.sku_id = s.id)
     and not exists (select 1 from public.mapeamentos_anuncio m where m.sku_id = s.id)
     and not exists (select 1 from public.sku_componentes c where c.componente_id = s.id);

  get diagnostics v_n = row_count;
  return query select true, 'ok', v_n, v_bloqueados;
end;
$$;

comment on function public.excluir_skus is
  'Apaga produtos e anota o codigo como ignorado, para a sincronizacao nao traze-los de volta. O que tem historico e recusado e volta nomeado.';

create or replace function public.voltar_a_importar(p_codigos text[])
returns table (ok boolean, motivo text, quantos integer)
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if coalesce(public.papel_atual()::text,'') not in ('lider','admin') then
    return query select false, 'sem_permissao', 0; return;
  end if;

  delete from public.catalogo_ignorado
   where codigo = any(select upper(btrim(x)) from unnest(coalesce(p_codigos,'{}')) x);

  get diagnostics v_n = row_count;
  return query select true, 'ok', v_n;
end;
$$;

comment on function public.voltar_a_importar is
  'Tira o codigo da lista de ignorados. A proxima sincronizacao volta a traze-lo.';

revoke all on function public.excluir_skus(uuid[]) from public, anon;
revoke all on function public.voltar_a_importar(text[]) from public, anon;
grant execute on function public.excluir_skus(uuid[]) to authenticated;
grant execute on function public.voltar_a_importar(text[]) to authenticated;

-- --------------------------------- a importação respeita a lista

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
  where e.situacao <> 'A'
     -- Ignorado conta junto com inativo: os dois são "não entra".
     or exists (select 1 from public.catalogo_ignorado g where g.codigo = e.codigo);

  select count(*) into v_sem_codigo
  from jsonb_to_recordset(v_entrada) as e(codigo text, erp_ref text, nome text, situacao text, foto text)
  where e.situacao = 'A' and (e.codigo = '' or e.erp_ref = '');

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
      -- A trava que faz a limpeza durar: quem foi apagado não volta.
      and not exists (select 1 from public.catalogo_ignorado g where g.codigo = e.codigo)
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
  'Cria o SKU que nao existe e casa o que existe. So situacao=A, e pula o que esta em catalogo_ignorado. Reentrante.';

revoke all on function public.importar_catalogo_erp(jsonb) from public, anon;
grant execute on function public.importar_catalogo_erp(jsonb) to authenticated;
