-- O operador vê o KIT; o Bling recebe as PEÇAS.
--
-- Foi um teste contra o Bling de produção que definiu isto. Lancei uma saída
-- de 1 no kit BC59-149, já com a composição cadastrada: o Bling respondeu 201
-- e NÃO moveu saldo nenhum — nem do kit, nem das três peças. Produto composto
-- lá tem `tipoEstoque: "V"`, estoque virtual: ele calcula a disponibilidade a
-- partir das peças e não tem onde pousar um movimento lançado no kit.
--
-- Aceita, devolve sucesso, não faz nada. É pior que erro: em produção toda
-- venda de kit reportaria sucesso e não baixaria peça nenhuma, e ninguém
-- perceberia até alguém contar a prateleira.
--
-- Então quem explode é o ZYNTRA, e explode SÓ na baixa:
--
--   lista de separação / coletor  -> deixa de explodir (operador vê o kit)
--   abertura da conferência       -> deixa de explodir (bipa o código do kit)
--   baixa no Bling                -> continua explodindo (já estava)
--
-- Produto que não é kit não muda em nada: `explodir_sku` devolve o próprio SKU
-- quando não há componentes. Quem decide é o cadastro no Bling, produto a
-- produto — kit sem composição lá continua baixando a si mesmo, como hoje.
--
-- ATENÇÃO para quem reaplicar do zero: o corpo de `varrer_composicoes` abaixo
-- tem um bloco inútil antes do acúmulo, corrigido na migração seguinte
-- (`conserta_o_acumulo_da_varredura_de_composicoes`). Está aqui como foi
-- aplicado, para o histórico bater.

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
begin
  if not pg_try_advisory_xact_lock(hashtext('zyntra.varrer_composicoes')) then
    return query select 0, 0, 0, 'ja_rodando'; return;
  end if;

  select c.access_token into v_token from privado.credenciais_erp c where c.id;
  if coalesce(v_token, '') = '' then
    return query select 0, 0, 0, 'sem_credencial'; return;
  end if;

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

    select coalesce(array_agg(d->>'id'), '{}')
      into strict v_todos
    from (
      select unnest(v_todos) as x
    ) velho full join lateral (select null::jsonb as d) nada on false;

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

  delete from public.sku_componentes sc
  where exists (
    select 1 from public.skus s
    where s.id = sc.kit_id
      and s.erp_ref = any(v_todos)
      and not (s.erp_ref = any(v_kits))
  );

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

    delete from public.sku_componentes where kit_id = v_kit_id;

    insert into public.sku_componentes (kit_id, componente_id, quantidade)
    select v_kit_id, s.id, greatest((c->>'quantidade')::numeric::integer, 1)
    from jsonb_array_elements(v_comp) c
    join public.skus s on s.erp_ref = c->'produto'->>'id'
    where s.id <> v_kit_id
    on conflict (kit_id, componente_id) do nothing;

    get diagnostics v_n_comp = row_count;

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

comment on function privado.varrer_composicoes is
  'Traz do Bling a composicao dos kits. Acha quem e kit pela lista (campo '
  'formato) e so entao busca o detalhe deles.';

create or replace function public.varrer_composicoes_ml(p_paginas integer default 20)
returns table (kits integer, componentes integer, sem_sku integer, motivo text)
language sql
security definer
set search_path to ''
as $$
  select * from privado.varrer_composicoes(p_paginas, 30);
$$;

revoke all on function public.varrer_composicoes_ml(integer) from public, anon, authenticated;

-- De hora em hora: composicao de kit nao muda o dia inteiro.
select cron.schedule('zyntra-composicoes', '23 * * * *',
                     $$ select public.varrer_composicoes_ml(20) $$);
