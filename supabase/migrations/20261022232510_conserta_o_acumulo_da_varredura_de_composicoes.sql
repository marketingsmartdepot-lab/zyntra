-- Eu deixei na migração anterior um `select ... into strict v_todos` sem
-- sentido antes do acúmulo real. Ele zerava a lista a cada página, então
-- `v_todos` só guardaria a ÚLTIMA — e a limpeza de quem deixou de ser kit
-- passaria a enxergar só os 100 últimos produtos do catálogo.
--
-- Sai o bloco. O acúmulo é só a concatenação.

create or replace function privado.varrer_composicoes(
  p_paginas integer default 20, p_limite_kits integer default 30
)
returns table (kits integer, componentes integer, sem_sku integer, motivo text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token text;
  v_r extensions.http_response;
  v_pagina integer := 1;
  v_fim integer := greatest(least(coalesce(p_paginas, 20), 40), 1);
  v_n_na_pagina integer;
  v_todos text[] := '{}';
  v_kits text[] := '{}';
  v_ref text;
  v_kit_id uuid;
  v_comp jsonb;
  v_n_kits integer := 0;
  v_n_comp integer := 0;
  v_n_sem integer := 0;
  v_inseridos integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('zyntra.varrer_composicoes')) then
    return query select 0, 0, 0, 'ja_rodando'; return;
  end if;

  select c.access_token into v_token from privado.credenciais_erp c where c.id;
  if coalesce(v_token, '') = '' then
    return query select 0, 0, 0, 'sem_credencial'; return;
  end if;

  -- 1. Quem e kit, pela lista: ela traz `formato` de 100 em 100.
  while v_pagina <= v_fim loop
    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');
      select * into v_r from extensions.http((
        'GET',
        'https://api.bling.com.br/Api/v3/produtos?pagina=' || v_pagina || '&limite=100',
        array[extensions.http_header('Accept','application/json'),
              extensions.http_header('Authorization','Bearer ' || v_token)],
        null, null)::extensions.http_request);
    exception when others then
      return query select v_n_kits, v_n_comp, v_n_sem, 'rede'; return;
    end;

    if v_r.status = 429 then
      return query select v_n_kits, v_n_comp, v_n_sem, 'limite_do_bling'; return;
    end if;
    exit when v_r.status <> 200;

    select count(*)::integer into v_n_na_pagina
    from jsonb_array_elements((v_r.content::jsonb)->'data');

    v_todos := v_todos || (
      select coalesce(array_agg(d->>'id'), '{}')
      from jsonb_array_elements((v_r.content::jsonb)->'data') d
    );

    v_kits := v_kits || (
      select coalesce(array_agg(d->>'id'), '{}')
      from jsonb_array_elements((v_r.content::jsonb)->'data') d
      where d->>'formato' = 'E'
    );

    exit when coalesce(v_n_na_pagina, 0) < 100;
    v_pagina := v_pagina + 1;
  end loop;

  -- 2. Quem deixou de ser kit no Bling perde a composicao aqui. Sem isto, uma
  --    composicao desfeita la continuaria explodindo para sempre.
  delete from public.sku_componentes sc
  where exists (
    select 1 from public.skus s
    where s.id = sc.kit_id
      and s.erp_ref = any(v_todos)
      and not (s.erp_ref = any(v_kits))
  );

  -- 3. O detalhe, so dos kits.
  foreach v_ref in array v_kits loop
    exit when v_n_kits >= greatest(coalesce(p_limite_kits, 30), 1);

    select s.id into v_kit_id from public.skus s where s.erp_ref = v_ref;
    continue when v_kit_id is null;

    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');
      select * into v_r from extensions.http((
        'GET', 'https://api.bling.com.br/Api/v3/produtos/' || v_ref,
        array[extensions.http_header('Accept','application/json'),
              extensions.http_header('Authorization','Bearer ' || v_token)],
        null, null)::extensions.http_request);
    exception when others then
      return query select v_n_kits, v_n_comp, v_n_sem, 'rede'; return;
    end;

    if v_r.status = 429 then
      return query select v_n_kits, v_n_comp, v_n_sem, 'limite_do_bling'; return;
    end if;
    continue when v_r.status <> 200;

    v_comp := coalesce(
      (v_r.content::jsonb)->'data'->'estrutura'->'componentes', '[]'::jsonb);

    -- Reescreve: a composicao e do Bling, nao historico daqui.
    delete from public.sku_componentes where kit_id = v_kit_id;

    insert into public.sku_componentes (kit_id, componente_id, quantidade)
    select v_kit_id, s.id, greatest((c->>'quantidade')::numeric::integer, 1)
    from jsonb_array_elements(v_comp) c
    join public.skus s on s.erp_ref = c->'produto'->>'id'
    where s.id <> v_kit_id
    on conflict (kit_id, componente_id) do nothing;

    get diagnostics v_inseridos = row_count;
    v_n_comp := v_n_comp + v_inseridos;

    -- Componente que o Bling tem e o ZYNTRA nao conhece: aparece no numero,
    -- em vez de sumir com a peca da conta.
    v_n_sem := v_n_sem + (
      select count(*)::integer from jsonb_array_elements(v_comp) c
      where not exists (
        select 1 from public.skus s where s.erp_ref = c->'produto'->>'id')
    );

    v_n_kits := v_n_kits + 1;
  end loop;

  return query select v_n_kits, v_n_comp, v_n_sem, 'ok'::text;
end;
$function$;
