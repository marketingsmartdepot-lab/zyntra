-- A foto do anúncio nunca chegou sozinha: `buscar_fotos_dos_anuncios` foi
-- escrita e NUNCA foi chamada — nem por tela, nem por cron. Dos 160 itens de
-- pedido, 8 têm foto, e esses 8 devem ser de uma rodada na mão.
--
-- Ela não dava para agendar como estava: exige `e_admin()`, e cron não tem
-- usuário logado — recusaria sozinha, calada. Então o corpo vai para o schema
-- privado (sem a trava de admin, porque quem chama é o cron) e ficam duas
-- portas, como já é no resto: a pública continua exigindo admin, para quando
-- alguém quiser forçar pela tela.
--
-- E a foto passa a aparecer no COLETOR, que é onde ela ajuda — a pessoa está
-- no corredor procurando a peça. Na folha impressa continua sem foto, de
-- propósito: em papel térmico ela sai borrada e gasta papel. Essa divisão já
-- existia; o que faltava era a foto chegar.

create or replace function privado.buscar_fotos_da_conta(
  p_conta_id uuid, p_lotes integer default 2
)
returns table (ok boolean, motivo text, anuncios integer, itens integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token text;
  v_r extensions.http_response;
  v_ids text[];
  v_lote text[];
  v_i integer;
  v_lote_n integer := 0;
  v_anuncios integer := 0;
  v_itens integer := 0;
  v_n integer;
  v_resp jsonb;
  v_corpo jsonb;
  v_foto text;
  v_id text;
begin
  select t.token into v_token from privado.token_ml(p_conta_id) t;
  if coalesce(v_token, '') = '' then
    return query select false, 'sem_conexao', 0, 0; return;
  end if;

  select array_agg(distinct pi.ref_anuncio) into v_ids
  from public.pedido_itens pi
  join public.pedidos pd on pd.id = pi.pedido_id
  where pd.conta_id = p_conta_id
    and pi.ref_anuncio is not null
    and pi.foto_url is null;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    return query select true, 'nada_a_buscar', 0, 0; return;
  end if;

  v_i := 1;
  while v_i <= array_length(v_ids, 1) and v_lote_n < greatest(coalesce(p_lotes, 2), 1) loop
    v_lote := v_ids[v_i : v_i + 19];
    v_lote_n := v_lote_n + 1;

    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
      select * into v_r from extensions.http((
        'GET',
        'https://api.mercadolibre.com/items?ids='
          || array_to_string(v_lote, ',')
          || '&attributes=id,thumbnail,secure_thumbnail,pictures',
        array[
          extensions.http_header('Accept', 'application/json'),
          extensions.http_header('Authorization', 'Bearer ' || v_token)
        ],
        null, null
      )::extensions.http_request);
    exception when others then
      -- Foto e enfeite util, nao dado de operacao: o que ja entrou fica, e a
      -- proxima passagem tenta o resto.
      return query select true, 'rede', v_anuncios, v_itens; return;
    end;

    if v_r.status between 200 and 299 then
      for v_resp in select * from jsonb_array_elements(v_r.content::jsonb) loop
        v_corpo := v_resp->'body';
        v_id := v_corpo->>'id';

        v_foto := coalesce(
          v_corpo#>>'{pictures,0,secure_url}',
          v_corpo#>>'{pictures,0,url}',
          nullif(v_corpo->>'secure_thumbnail', ''),
          nullif(v_corpo->>'thumbnail', ''));

        if v_id is not null and v_foto is not null then
          update public.pedido_itens pi
             set foto_url = v_foto
           where pi.ref_anuncio = v_id
             and pi.foto_url is null
             and pi.pedido_id in (
               select pd.id from public.pedidos pd where pd.conta_id = p_conta_id
             );

          get diagnostics v_n = row_count;
          v_itens := v_itens + v_n;
          v_anuncios := v_anuncios + 1;
        end if;
      end loop;
    end if;

    v_i := v_i + 20;
  end loop;

  return query select true, 'ok', v_anuncios, v_itens;
end;
$function$;

comment on function privado.buscar_fotos_da_conta is
  'Busca no ML a foto dos anuncios dos itens que ainda nao tem. Sem trava de '
  'admin, porque quem chama e o cron.';

-- A porta da tela continua exigindo admin.
create or replace function public.buscar_fotos_dos_anuncios(
  p_conta_id uuid, p_lotes integer default 3
)
returns table (ok boolean, motivo text, anuncios integer, itens integer)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.e_admin() then
    return query select false, 'so_admin', 0, 0; return;
  end if;

  if not exists (select 1 from public.contas c where c.id = p_conta_id) then
    return query select false, 'conta_nao_encontrada', 0, 0; return;
  end if;

  return query select * from privado.buscar_fotos_da_conta(p_conta_id, p_lotes);
end;
$function$;

/**
 * A casca que o cron chama: percorre as contas conectadas.
 *
 * Mesma forma de `varrer_pedidos_ml` e das outras — a função por conta mora no
 * privado, e esta aqui sabe quais contas existem.
 */
create or replace function public.varrer_fotos_ml(p_lotes integer default 2)
returns table (contas integer, anuncios integer, itens integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c record;
  v_r record;
  n_contas integer := 0; n_anun integer := 0; n_itens integer := 0;
begin
  for v_c in
    select ct.id
    from public.contas ct
    join public.canais ca on ca.id = ct.canal_id
    where ca.slug = 'mercado_livre' and ct.situacao = 'conectada'
    order by ct.criada_em
  loop
    n_contas := n_contas + 1;
    select * into v_r from privado.buscar_fotos_da_conta(v_c.id, p_lotes);
    n_anun := n_anun + coalesce(v_r.anuncios, 0);
    n_itens := n_itens + coalesce(v_r.itens, 0);
  end loop;

  return query select n_contas, n_anun, n_itens;
end;
$function$;

comment on function public.varrer_fotos_ml is
  'Percorre as contas conectadas buscando a foto dos anuncios que faltam.';

revoke all on function public.varrer_fotos_ml(integer) from public, anon, authenticated;

-- De dez em dez minutos: foto e conforto, nao operacao.
select cron.schedule('zyntra-fotos-ml', '8-59/10 * * * *',
                     $$ select public.varrer_fotos_ml(2) $$);

-- ---------------------------------------------------------------------------
-- O coletor passa a usar a foto do PEDIDO quando o SKU nao tem nenhuma.
--
-- Assim ela aparece sem ninguem cadastrar foto de catalogo — e deixa de
-- importar que 821 SKUs nao tenham foto no Bling, porque o que entra numa
-- lista, por definicao, vendeu.
--
-- `e.sku_id = m.sku_id` e a guarda do KIT: quando o anuncio explode em varios
-- componentes, a foto do anuncio e a foto do KIT, e po-la em cada componente
-- mandaria a pessoa procurar a caixa errada no corredor. Hoje nao existe kit
-- cadastrado, mas a guarda fica para o dia que existir.
create or replace view public.listas_itens as
 select lp.lista_id,
    e.sku_id,
    s.codigo,
    s.descricao,
    coalesce(
      min(s.foto_url),
      min(case when e.sku_id = m.sku_id then i.foto_url end)
    ) as foto_url,
    cb.codigo as codigo_barras,
    sum(e.quantidade)::integer as unidades,
    count(distinct pa.id)::integer as pacotes
   from public.listas_pacotes lp
     join public.pacotes pa on pa.id = lp.pacote_id
     join public.pedidos p on p.envio_id = pa.envio_id
     join public.pedido_itens i on i.pedido_id = p.id
     join public.mapeamentos_anuncio m
       on m.conta_id = p.conta_id
      and m.ref_anuncio = i.ref_anuncio
      and coalesce(m.ref_variacao, ''::text) = coalesce(i.ref_variacao, ''::text)
     cross join lateral public.explodir_sku(m.sku_id, i.quantidade) e(sku_id, quantidade)
     join public.skus s on s.id = e.sku_id
     left join lateral (
       select c.codigo from public.sku_codigos_barras c
       where c.sku_id = e.sku_id and c.principal limit 1
     ) cb on true
  group by lp.lista_id, e.sku_id, s.codigo, s.descricao, cb.codigo;

-- `create or replace view` APAGA as opcoes da view. Sem isto ela volta a ser
-- security definer e le as tabelas-base com os direitos de quem a criou.
alter view public.listas_itens set (security_invoker = true);
