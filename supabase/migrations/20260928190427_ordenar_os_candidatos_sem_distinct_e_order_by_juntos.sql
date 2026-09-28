-- Na saída quem bipa a ETIQUETA, não o SKU. E a etiqueta do ML tem até três
-- códigos — que eu li do ZPL guardado no banco, não de documentação nem de
-- chute:
--
--   ^BCN  >:48117509920                      código de barras: id do envio
--   ^BQN  LA,{"id":"48117509920","t":"lm"}   o QR
--   ^BCN  >;3526095969478...  (44 dígitos)   código da DANFE: chave da NF-e
--
-- **No Flex existe SÓ o QR** — a etiqueta não traz código de barras nenhum.
-- Sem entender o QR, Flex seria impossível de bipar na saída.
--
-- O leitor de código de barras entrega "48117509920" e isso já funcionava. O
-- QR entrega um JSON, e não achava nada. A chave da NF-e também não.
--
-- Então a busca passa a extrair CANDIDATOS do que foi lido, em vez de exigir
-- que a string inteira seja o identificador. Serve para o QR de hoje, para o
-- "Envio: 4811884 6989" impresso com espaço, e sobrevive a um prefixo novo que
-- o ML resolva colocar amanhã.
--
-- (Esta é a versão corrigida: `array_agg(distinct x order by length(x))` não é
-- válido — com DISTINCT o ORDER BY tem de ser pela própria expressão agregada.)
create or replace function public.pacote_por_codigo(p_codigo text)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_bruto text := upper(btrim(coalesce(p_codigo, '')));
  v_pacote uuid;
  v_cand text;
  v_cands text[];
begin
  if v_bruto = '' then
    return null;
  end if;

  -- 1. A leitura inteira, como veio. É o caso do código de barras.
  select pa.id into v_pacote
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  where upper(e.ref_externa) = v_bruto
  limit 1;
  if v_pacote is not null then return v_pacote; end if;

  select pa.id into v_pacote
  from public.pacotes pa
  join public.pedidos p on p.envio_id = pa.envio_id
  where upper(p.ref_externa) = v_bruto or upper(p.pack_ref) = v_bruto
  limit 1;
  if v_pacote is not null then return v_pacote; end if;

  -- 2. Os números que existem dentro da leitura, do maior para o menor. O QR
  --    do Flex cai aqui: de {"ID":"48117509920","T":"LM"} sai 48117509920.
  select array_agg(n order by length(n) desc) into v_cands
  from (
    select distinct x[1] as n
    from regexp_matches(v_bruto, '([0-9]{8,60})', 'g') as x
  ) y;

  -- Sem espaços, o "Envio: 4811884 6989" vira um número só.
  if v_bruto ~ '[0-9]{4,}[^0-9]+[0-9]{4,}' then
    v_cands := coalesce(v_cands, '{}') ||
      array[regexp_replace(v_bruto, '[^0-9]', '', 'g')];
  end if;

  if v_cands is null then return null; end if;

  foreach v_cand in array v_cands loop
    select pa.id into v_pacote
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    where upper(e.ref_externa) = v_cand
    limit 1;
    if v_pacote is not null then return v_pacote; end if;

    select pa.id into v_pacote
    from public.pacotes pa
    join public.pedidos p on p.envio_id = pa.envio_id
    where upper(p.ref_externa) = v_cand or upper(p.pack_ref) = v_cand
    limit 1;
    if v_pacote is not null then return v_pacote; end if;

    -- 3. A chave da NF-e, do código de barras da DANFE: 44 dígitos.
    if length(v_cand) = 44 then
      select nf.pacote_id into v_pacote
      from public.notas_fiscais nf
      where nf.chave_acesso = v_cand and nf.pacote_id is not null
      limit 1;
      if v_pacote is not null then return v_pacote; end if;
    end if;
  end loop;

  return null;
end;
$fn$;

revoke all on function public.pacote_por_codigo(text) from public;
grant execute on function public.pacote_por_codigo(text) to authenticated;
