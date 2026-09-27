-- A foto do ANÚNCIO, não a do produto no ERP.
--
-- É a foto que o comprador viu, e é por ela que alguém reconhece de relance
-- que pegou a caixa errada. A do ERP entra só quando o anúncio não tem: foto
-- de catálogo costuma ser a peça isolada, enquanto o anúncio mostra o que foi
-- vendido — e em anúncio de kit essa diferença decide se o separador pega uma
-- peça ou três.
--
-- O pedido do ML NÃO traz a foto: vem id, título, SKU e variações. A imagem
-- mora no anúncio, que é outro endereço. Uma chamada resolve até 20 anúncios,
-- porque o ML tem consulta em lote — buscar um por item seria uma ida de rede
-- por linha do pedido, e o tempo de consulta do usuário autenticado é de 8s.
create or replace function public.buscar_fotos_dos_anuncios(
  p_conta_id uuid,
  p_lotes integer default 3
) returns table(ok boolean, motivo text, anuncios integer, itens integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_conta record;
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
  if not public.e_admin() then
    return query select false, 'so_admin', 0, 0; return;
  end if;

  select * into v_conta from public.contas c where c.id = p_conta_id;
  if not found then
    return query select false, 'conta_nao_encontrada', 0, 0; return;
  end if;

  select t.token into v_token from privado.token_ml(p_conta_id) t;
  if coalesce(v_token, '') = '' then
    return query select false, 'sem_conexao', 0, 0; return;
  end if;

  -- Só os anúncios que ainda não têm foto em item nenhum.
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
  while v_i <= array_length(v_ids, 1) and v_lote_n < greatest(coalesce(p_lotes, 3), 1) loop
    v_lote := v_ids[v_i : v_i + 19];
    v_lote_n := v_lote_n + 1;

    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '4000');
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
      -- Foto é enfeite útil, não dado de operação: o que já entrou fica, e a
      -- próxima passagem tenta o resto.
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
$$;

revoke all on function public.buscar_fotos_dos_anuncios(uuid, integer) from public;
grant execute on function public.buscar_fotos_dos_anuncios(uuid, integer) to authenticated;
