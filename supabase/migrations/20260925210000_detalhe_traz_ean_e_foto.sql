-- A mesma chamada traz o EAN e a foto.
--
-- Os dois só existem no detalhe do produto: a listagem não tem gtin, e o
-- `imagemURL` dela vem vazio para boa parte do catálogo. A foto de verdade
-- mora em midia.imagens.externas[0].link — conferido na API.
--
-- Abrir o detalhe duas vezes, uma para cada coisa, seria o dobro de chamadas
-- para o mesmo produto. Então a rotina passa a olhar quem falta EAN OU foto, e
-- aproveita a visita.

comment on column public.skus.ean_verificado_em is
  'Quando o detalhe deste produto foi lido no Bling (de onde vem o gtin e a foto). Existe para nao reperguntar todo minuto por produto que simplesmente nao tem.';

drop index if exists public.skus_sem_ean_idx;
create index if not exists skus_a_enriquecer_idx
  on public.skus (ean_verificado_em nulls first)
  where ativo and erp_ref is not null;

create or replace function privado.buscar_eans(p_limite integer default 60)
returns table (verificados integer, encontrados integer, sem_ean integer, falhas integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text; v_expira timestamptz;
  v_sku record; v_r extensions.http_response; v_d jsonb;
  v_gtin text; v_foto text; v_inseriu integer;
  v_ver integer := 0; v_enc integer := 0; v_sem integer := 0; v_fal integer := 0;
begin
  select c.access_token, c.expira_em into v_token, v_expira
  from privado.credenciais_erp c where c.id;

  if coalesce(v_token,'') = '' or (v_expira is not null and v_expira < now()) then
    return query select 0,0,0,0;
    return;
  end if;

  for v_sku in
    select s.id, s.erp_ref,
           not exists (select 1 from public.sku_codigos_barras b where b.sku_id = s.id) as falta_ean,
           coalesce(s.foto_url,'') = '' as falta_foto
    from public.skus s
    where s.ativo
      and coalesce(s.erp_ref,'') <> ''
      and (
        not exists (select 1 from public.sku_codigos_barras b where b.sku_id = s.id)
        or coalesce(s.foto_url,'') = ''
      )
      -- Produto que o Bling não tem é reperguntado só uma vez por semana: sem
      -- isso, a rotina passaria a vida batendo nos mesmos.
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
      exit when v_r.status = 401;
      continue;
    end if;

    v_ver := v_ver + 1;
    v_d := coalesce((v_r.content::jsonb)->'data','{}'::jsonb);

    update public.skus set ean_verificado_em = now() where id = v_sku.id;

    -- ---------------------------------------------------------- a foto
    if v_sku.falta_foto then
      v_foto := btrim(coalesce(
        v_d->'midia'->'imagens'->'externas'->0->>'link',
        v_d->'midia'->'imagens'->'internas'->0->>'link',
        v_d->'midia'->'imagens'->'imagensURL'->0->>'link',
        v_d->>'imagemURL',
        ''
      ));

      if v_foto <> '' then
        update public.skus
           set foto_url = v_foto, atualizado_em = now()
         where id = v_sku.id and coalesce(foto_url,'') = '';
      end if;
    end if;

    -- ----------------------------------------------------------- o EAN
    if not v_sku.falta_ean then
      continue;
    end if;

    v_gtin := btrim(coalesce(v_d->>'gtin', ''));

    if v_gtin = '' then
      v_sem := v_sem + 1;
      continue;
    end if;

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
  'Le o detalhe do produto no Bling e aproveita a visita: guarda o gtin como codigo de barras e a foto quando faltar. Interna: quem chama e o cron ou o wrapper com guarda.';

revoke all on function privado.buscar_eans(integer) from public, anon, authenticated;
