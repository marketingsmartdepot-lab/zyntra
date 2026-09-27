-- A busca contava código repetido como "sem EAN" e seguia. Agora que a
-- unicidade é por (sku, código), o conflito só existe se ESTE produto já
-- tivesse ESTE código — e aí não há nada a fazer mesmo.
create or replace function privado.buscar_eans(p_limite integer default 60)
returns table(verificados integer, encontrados integer, sem_ean integer, falhas integer)
language plpgsql
security definer
set search_path to ''
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
      and (s.ean_verificado_em is null or s.ean_verificado_em < now() - interval '1 day')
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

    if not v_sku.falta_ean then
      continue;
    end if;

    v_gtin := btrim(coalesce(v_d->>'gtin', ''));

    if v_gtin = '' then
      v_sem := v_sem + 1;
      continue;
    end if;

    insert into public.sku_codigos_barras (sku_id, codigo, tipo, principal)
    values (v_sku.id, v_gtin, 'ean', true)
    on conflict (sku_id, codigo) do nothing;

    get diagnostics v_inseriu = row_count;
    if v_inseriu > 0 then v_enc := v_enc + 1; end if;
  end loop;

  return query select v_ver, v_enc, v_sem, v_fal;
end;
$$;
