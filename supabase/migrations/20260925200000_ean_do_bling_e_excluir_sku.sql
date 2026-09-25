-- 1. O EAN, que é o que a bancada bipa.
--
-- A listagem de produtos do Bling NÃO traz gtin. Ele só aparece no detalhe,
-- /produtos/{id}, uma chamada por produto. Com 1.555 produtos isso é ~8 minutos
-- de chamadas: não cabe num clique, então roda em segundo plano, um punhado por
-- minuto, e a tela mostra o progresso.
--
-- Conferido na API antes de escrever: o campo é `gtin`.

alter table public.skus add column if not exists ean_verificado_em timestamptz;

comment on column public.skus.ean_verificado_em is
  'Quando o Bling foi consultado atras do gtin deste produto. Existe para nao reperguntar todo minuto por produto que simplesmente nao tem EAN cadastrado la.';

create index if not exists skus_sem_ean_idx
  on public.skus (ean_verificado_em nulls first)
  where ativo and erp_ref is not null;

create or replace function privado.buscar_eans(p_limite integer default 60)
returns table (verificados integer, encontrados integer, sem_ean integer, falhas integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text; v_expira timestamptz;
  v_sku record; v_r extensions.http_response; v_gtin text; v_inseriu integer;
  v_ver integer := 0; v_enc integer := 0; v_sem integer := 0; v_fal integer := 0;
begin
  select c.access_token, c.expira_em into v_token, v_expira
  from privado.credenciais_erp c where c.id;

  if coalesce(v_token,'') = '' or (v_expira is not null and v_expira < now()) then
    return query select 0,0,0,0;
    return;
  end if;

  for v_sku in
    select s.id, s.erp_ref from public.skus s
    where s.ativo
      and coalesce(s.erp_ref,'') <> ''
      and not exists (select 1 from public.sku_codigos_barras b where b.sku_id = s.id)
      -- Produto sem EAN no Bling é reperguntado só uma vez por semana: sem
      -- isso, a rotina passaria a vida batendo nos mesmos que não têm.
      and (s.ean_verificado_em is null or s.ean_verificado_em < now() - interval '7 days')
    order by s.ean_verificado_em nulls first, s.codigo
    limit greatest(least(coalesce(p_limite, 60), 200), 1)
  loop
    begin
      select * into v_r from extensions.http((
        'GET', 'https://api.bling.com.br/Api/v3/produtos/' || v_sku.erp_ref,
        array[extensions.http_header('Accept','application/json'),
              extensions.http_header('Authorization','Bearer ' || v_token)],
        null, null)::extensions.http_request);
    exception when others then
      v_fal := v_fal + 1; continue;
    end;

    if v_r.status <> 200 then
      v_fal := v_fal + 1;
      -- 401 não adianta insistir nos outros: a credencial caiu.
      exit when v_r.status = 401;
      continue;
    end if;

    v_ver := v_ver + 1;
    v_gtin := btrim(coalesce((v_r.content::jsonb)->'data'->>'gtin', ''));
    update public.skus set ean_verificado_em = now() where id = v_sku.id;

    if v_gtin = '' then v_sem := v_sem + 1; continue; end if;

    -- O mesmo EAN em dois SKUs faria a bipagem escolher o errado. O índice
    -- único decide; aqui o conflito é pulado, não forçado.
    insert into public.sku_codigos_barras (sku_id, codigo, tipo, principal)
    values (v_sku.id, v_gtin, 'ean', true)
    on conflict (codigo) do nothing;

    get diagnostics v_inseriu = row_count;
    if v_inseriu > 0 then v_enc := v_enc + 1; else v_sem := v_sem + 1; end if;
  end loop;

  return query select v_ver, v_enc, v_sem, v_fal;
end;
$$;

comment on function privado.buscar_eans is
  'Pega o gtin no detalhe do produto do Bling e guarda como codigo de barras. Interna: quem chama e o cron ou o wrapper com guarda.';

revoke all on function privado.buscar_eans(integer) from public, anon, authenticated;

create or replace function public.buscar_eans_agora(p_limite integer default 20)
returns table (verificados integer, encontrados integer, sem_ean integer, falhas integer)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.e_admin() then
    raise exception 'So administrador busca os codigos de barras.'
      using errcode = 'insufficient_privilege';
  end if;
  return query select * from privado.buscar_eans(p_limite);
end;
$$;

revoke all on function public.buscar_eans_agora(integer) from public, anon;
grant execute on function public.buscar_eans_agora(integer) to authenticated;

-- De minuto em minuto, 60 por vez: ~1 chamada por segundo, e o catálogo
-- inteiro fica coberto em meia hora.
select cron.schedule('zyntra-ean-do-bling', '* * * * *',
                     $cron$select privado.buscar_eans(60)$cron$);

-- 2. Apagar produto do catálogo.
--
-- Apagar de verdade, não esconder — foi o que ela pediu depois de eu propor
-- desativar. Quatro tabelas referenciam SKU com RESTRICT (conferência, baixa,
-- mapeamento de anúncio e kit) e o banco recusa apagar quem tem histórico.
-- Então a função apaga o que dá e DEVOLVE a lista do que não deu, com o
-- motivo: falhar em bloco e calada deixaria ela sem saber quais sumiram.

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
  'Apaga produtos do catalogo. O que tem historico (conferencia, baixa, anuncio, kit) e recusado pelo banco e volta na lista de bloqueados, com o motivo.';

revoke all on function public.excluir_skus(uuid[]) from public, anon;
grant execute on function public.excluir_skus(uuid[]) to authenticated;

-- 3. Os números da tela.

drop view if exists public.catalogo_resumo;

create view public.catalogo_resumo
with (security_invoker = true)
as
select
  count(*)::integer as total,
  count(*) filter (where coalesce(s.erp_ref,'') <> '')::integer as com_bling,
  count(*) filter (where coalesce(s.erp_ref,'') = '')::integer as sem_bling,
  count(*) filter (where coalesce(s.foto_url,'') = '')::integer as sem_foto,
  count(*) filter (where exists (
    select 1 from public.sku_codigos_barras b where b.sku_id = s.id))::integer as com_ean,
  count(*) filter (where not exists (
    select 1 from public.sku_codigos_barras b where b.sku_id = s.id))::integer as sem_ean,
  -- Já perguntamos ao Bling e ele não tem: esses não se resolvem esperando.
  count(*) filter (where s.ean_verificado_em is not null and not exists (
    select 1 from public.sku_codigos_barras b where b.sku_id = s.id))::integer as sem_ean_no_bling,
  max(s.sincronizado_em) as ultima_sincronizacao
from public.skus s
where s.ativo;

comment on view public.catalogo_resumo is
  'Os numeros do catalogo. sem_ean importa porque a conferencia na bancada e por bipagem; sem_ean_no_bling e o que o Bling ja disse que nao tem.';

revoke all on public.catalogo_resumo from anon;
grant select on public.catalogo_resumo to authenticated;
