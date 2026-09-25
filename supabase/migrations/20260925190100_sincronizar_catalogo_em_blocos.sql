-- Sincronizar o catálogo inteiro leva ~9 segundos (17 páginas a ~530ms, medido
-- contra o Bling de verdade). O limite de uma requisição autenticada no
-- PostgREST é 8s, então fazer tudo de uma vez estouraria — e estouraria calado,
-- no meio, deixando metade importada sem ninguém saber onde parou.
--
-- Vai em blocos: cada chamada processa um punhado de páginas e diz se ainda há
-- mais. Quem encadeia é a ação da tela, que tem folga de tempo maior.

create or replace function public.sincronizar_catalogo_erp(
  p_pagina_inicial integer default 1,
  p_paginas integer default 8
)
returns table (
  ok boolean, motivo text, detalhe text,
  proxima_pagina integer, tem_mais boolean,
  produtos integer, criados integer, casados integer, ja_estavam integer,
  sem_codigo integer, inativos integer, codigos_repetidos text[]
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text; v_expira timestamptz;
  v_r extensions.http_response; v_data jsonb;
  v_pagina integer := greatest(coalesce(p_pagina_inicial, 1), 1);
  v_fim integer := v_pagina + greatest(least(coalesce(p_paginas, 8), 20), 1) - 1;
  v_x record;
  t_prod integer := 0; t_cri integer := 0; t_cas integer := 0; t_ja integer := 0;
  t_sem integer := 0; t_ina integer := 0; t_rep text[] := '{}';
begin
  if not public.e_admin() then
    return query select false, 'so_admin', null::text, v_pagina, false, 0,0,0,0,0,0,'{}'::text[];
    return;
  end if;

  select c.access_token, c.expira_em into v_token, v_expira
  from privado.credenciais_erp c where c.id;

  if coalesce(v_token,'') = '' then
    return query select false, 'sem_conexao', null::text, v_pagina, false, 0,0,0,0,0,0,'{}'::text[];
    return;
  end if;

  if v_expira is not null and v_expira < now() then
    return query select false, 'conexao_expirada', null::text, v_pagina, false, 0,0,0,0,0,0,'{}'::text[];
    return;
  end if;

  while v_pagina <= v_fim loop
    begin
      select * into v_r from extensions.http((
        'GET',
        'https://api.bling.com.br/Api/v3/produtos?pagina=' || v_pagina || '&limite=100',
        array[
          extensions.http_header('Accept','application/json'),
          extensions.http_header('Authorization','Bearer ' || v_token)
        ],
        null, null
      )::extensions.http_request);
    exception when others then
      -- O que já entrou está gravado. Devolve onde parou para retomar dali.
      return query select false, 'rede', sqlerrm, v_pagina, true,
                          t_prod, t_cri, t_cas, t_ja, t_sem, t_ina, t_rep;
      return;
    end;

    if v_r.status <> 200 then
      return query select false,
        case when v_r.status = 401 then 'conexao_recusada' else 'recusado' end,
        'Bling respondeu ' || v_r.status || ': ' || left(coalesce(v_r.content,''), 300),
        v_pagina, true, t_prod, t_cri, t_cas, t_ja, t_sem, t_ina, t_rep;
      return;
    end if;

    v_data := coalesce((v_r.content::jsonb)->'data', '[]'::jsonb);

    -- Página vazia = acabou o catálogo.
    if jsonb_array_length(v_data) = 0 then
      return query select true, 'ok', null::text, v_pagina, false,
                          t_prod, t_cri, t_cas, t_ja, t_sem, t_ina, t_rep;
      return;
    end if;

    t_prod := t_prod + jsonb_array_length(v_data);

    select * into v_x from public.importar_catalogo_erp(
      (select coalesce(jsonb_agg(jsonb_build_object(
                'id', d->>'id', 'codigo', d->>'codigo', 'nome', d->>'nome',
                'situacao', d->>'situacao', 'foto', d->>'imagemURL')), '[]'::jsonb)
       from jsonb_array_elements(v_data) d)
    );

    t_cri := t_cri + v_x.criados;  t_cas := t_cas + v_x.casados;
    t_ja  := t_ja  + v_x.ja_estavam; t_sem := t_sem + v_x.sem_codigo;
    t_ina := t_ina + v_x.inativos; t_rep := t_rep || v_x.codigos_repetidos;

    v_pagina := v_pagina + 1;
  end loop;

  -- Saiu pelo orçamento de páginas, não pelo fim do catálogo.
  return query select true, 'ok', null::text, v_pagina, true,
                      t_prod, t_cri, t_cas, t_ja, t_sem, t_ina, t_rep;
end;
$$;

comment on function public.sincronizar_catalogo_erp is
  'Importa o catalogo do Bling em blocos de paginas. Devolve onde parou: o total nao cabe no limite de 8s de uma requisicao.';

revoke all on function public.sincronizar_catalogo_erp(integer, integer) from public, anon;
grant execute on function public.sincronizar_catalogo_erp(integer, integer) to authenticated;

create or replace view public.catalogo_resumo
with (security_invoker = true)
as
select
  count(*)::integer as total,
  count(*) filter (where coalesce(erp_ref,'') <> '')::integer as com_bling,
  count(*) filter (where coalesce(erp_ref,'') = '')::integer as sem_bling,
  count(*) filter (where coalesce(foto_url,'') = '')::integer as sem_foto,
  count(*) filter (where not exists (
    select 1 from public.sku_codigos_barras b where b.sku_id = s.id
  ))::integer as sem_codigo_barras,
  max(sincronizado_em) as ultima_sincronizacao
from public.skus s
where s.ativo;

comment on view public.catalogo_resumo is
  'Os numeros do catalogo. sem_codigo_barras importa porque a conferencia na bancada e por bipagem.';

revoke all on public.catalogo_resumo from anon;
grant select on public.catalogo_resumo to authenticated;
