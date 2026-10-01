-- O bloqueio que ninguém levantava.
--
-- `sku_nao_mapeado` já estava no enum `bloqueio_tipo`, a aba Aberto já sabia
-- agrupá-lo ("Anúncio sem SKU correspondente") e `destravar_por_mapeamento()`
-- já sabia soltá-lo quando o mapeamento aparecia. Faltava a ponta que ABRE o
-- bloqueio — então ele nunca existia, e o pacote seguia.
--
-- Por que isso deixa caixa sair errada: `listas_itens` junta
-- `mapeamentos_anuncio` por INNER JOIN. Anúncio sem SKU não gera linha
-- nenhuma. O produto não aparece na lista de separação, `separacao_progresso`
-- também não o tem, e `fechar_separacao` só pergunta "sobrou linha
-- incompleta?" — não sobra. A lista fecha TODA VERDE com um produto que nunca
-- foi pego nem mostrado a ninguém.
--
-- Três camadas, da prevenção à última linha de defesa:
--   1. coletar_etiquetas_ml abre o bloqueio, e o portão que já existe
--      ("not exists bloqueio aberto") segura o pacote em Faturado.
--   2. criar_lista recusa na origem, para ninguém começar uma lista que não
--      vai poder fechar.
--   3. fechar_separacao trava, para o caso de lista criada antes disto.

do $$
declare
  v_def text;
  v_novo text;
  v_ancora text;
begin

-- ---------------------------------------------------------------- 1. abrir
v_def := pg_get_functiondef('public.coletar_etiquetas_ml()'::regprocedure);

v_ancora := '  update public.pacotes pa
     set etapa = ''separar'', etapa_anterior = pa.etapa, etapa_desde = now(),';

if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
  raise exception 'ancora da promocao aparece % vezes em coletar_etiquetas_ml',
    (length(v_def) - length(replace(v_def, v_ancora, ''))) / nullif(length(v_ancora), 0);
end if;

v_novo := replace(v_def, v_ancora,
'  -- Anuncio sem SKU: o item desaparece da lista de separacao, porque
  -- listas_itens junta mapeamentos_anuncio por INNER JOIN. Abrir o bloqueio
  -- aqui faz o portao abaixo segurar o pacote em Faturado, a aba Aberto
  -- mostra a causa, e destravar_por_mapeamento() solta quando ela mapear.
  insert into public.bloqueios (pacote_id, tipo, causa)
  select pa.id, ''sku_nao_mapeado'',
         ''Sem SKU correspondente: '' || string_agg(distinct
           i.ref_anuncio || coalesce('' / '' || i.ref_variacao, ''''), '', '')
  from public.pacotes pa
  join public.pedidos p on p.envio_id = pa.envio_id
  join public.pedido_itens i on i.pedido_id = p.id
  where pa.etapa = ''faturado''
    and not exists (
      select 1 from public.mapeamentos_anuncio m
      where m.conta_id = p.conta_id
        and m.ref_anuncio = i.ref_anuncio
        and coalesce(m.ref_variacao, '''') = coalesce(i.ref_variacao, '''')
    )
    and not exists (
      select 1 from public.bloqueios b
      where b.pacote_id = pa.id
        and b.tipo = ''sku_nao_mapeado''
        and b.resolvido_em is null
    )
  group by pa.id;

' || v_ancora);

execute v_novo;

-- -------------------------------------------------------------- 2. recusar
v_def := pg_get_functiondef('public.criar_lista(uuid[],text)'::regprocedure);

v_ancora := '  -- Sem separador: ele se identifica no coletor, por PIN.';

if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
  raise exception 'ancora do insert aparece % vezes em criar_lista',
    (length(v_def) - length(replace(v_def, v_ancora, ''))) / nullif(length(v_ancora), 0);
end if;

v_novo := replace(v_def, v_ancora,
'  -- Anuncio sem SKU nao tem codigo de barras para bipar, entao a lista nunca
  -- ficaria toda verde e nao fecharia. Recusar aqui e melhor que deixar
  -- alguem andar o galpao inteiro para descobrir isso no fim.
  if exists (
    select 1
    from public.pacotes pa
    join public.pedidos p on p.envio_id = pa.envio_id
    join public.pedido_itens i on i.pedido_id = p.id
    where pa.id = any(p_pacote_ids)
      and not exists (
        select 1 from public.mapeamentos_anuncio m
        where m.conta_id = p.conta_id
          and m.ref_anuncio = i.ref_anuncio
          and coalesce(m.ref_variacao, '''') = coalesce(i.ref_variacao, '''')
      )
  ) then
    return query select false, ''pacote_sem_sku_mapeado'', null::uuid, 0, 0;
    return;
  end if;

' || v_ancora);

execute v_novo;

-- ---------------------------------------------------------------- 3. travar
v_def := pg_get_functiondef('public.fechar_separacao(uuid)'::regprocedure);

v_ancora := '  select coalesce(jsonb_agg(jsonb_build_object(';

if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
  raise exception 'ancora do faltando aparece % vezes em fechar_separacao',
    (length(v_def) - length(replace(v_def, v_ancora, ''))) / nullif(length(v_ancora), 0);
end if;

v_novo := replace(v_def, v_ancora,
'  -- A ultima linha de defesa, para lista criada antes da trava de cima.
  -- Item sem SKU nao gera linha em separacao_progresso, entao a checagem de
  -- "faltam itens" logo abaixo nao o ve: ela olha o que existe, e o problema
  -- e justamente o que nao existe. Sem isto a lista fecha toda verde.
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           ''codigo'', i.ref_anuncio, ''descricao'', i.titulo,
           ''separado'', 0, ''esperado'', i.quantidade)), ''[]''::jsonb)
    into v_faltando
  from public.listas_pacotes lp
  join public.pacotes pa on pa.id = lp.pacote_id
  join public.pedidos p on p.envio_id = pa.envio_id
  join public.pedido_itens i on i.pedido_id = p.id
  where lp.lista_id = p_lista_id
    and not exists (
      select 1 from public.mapeamentos_anuncio m
      where m.conta_id = p.conta_id
        and m.ref_anuncio = i.ref_anuncio
        and coalesce(m.ref_variacao, '''') = coalesce(i.ref_variacao, '''')
    );

  if jsonb_array_length(v_faltando) > 0 then
    return query select false, ''itens_sem_sku'', 0, v_faltando;
    return;
  end if;

' || v_ancora);

execute v_novo;

end $$;

comment on function public.coletar_etiquetas_ml is
  'Guarda as etiquetas que voltaram do ML, abre sku_nao_mapeado para anuncio '
  'sem SKU, e promove para Separar o que tem etiqueta e nenhum bloqueio.';
