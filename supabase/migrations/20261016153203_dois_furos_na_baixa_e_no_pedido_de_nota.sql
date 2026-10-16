-- Dois furos que a mudança de gatilho expôs.
--
-- 1. BAIXA SEM ITEM GIRA PARA SEMPRE. `drenar_baixas` monta os itens, confere
--    se algum SKU está sem referência no Bling, e manda. Mas se a montagem
--    devolve ZERO itens — anúncio sem SKU mapeado, que é o caso que
--    `itens_para_baixa` não tem como resolver — a conferência de referência
--    não acha nada (não há linha nenhuma), o laço de envio não roda, e a baixa
--    volta para a fila com espera maior. Para sempre, sem erro, sem aviso.
--    Antes era improvável porque o gatilho nunca disparava. Agora a baixa
--    nasce no instante da venda, ANTES de qualquer checagem de mapeamento.
--
--    De passagem: a espera crescente é `power(3, tentativas + 1)` convertido
--    para integer. Na tentativa 19 isso passa de 2 bilhões e estoura o
--    integer, derrubando o cron. O teto de uma hora já estava lá, mas é
--    aplicado DEPOIS da conta. Limitei o expoente.
--
-- 2. O FILTRO DE PEDIDO CANCELADO QUE NÃO FILTRA. `pedir_notas_ml`, que eu
--    escrevi dia 14, exige `p.cancelado_em is null`. Essa coluna NUNCA é
--    gravada por ninguém — fica sempre nula, então a condição é sempre
--    verdadeira e pedido cancelado pediria nota. O cancelamento mora em
--    `situacao_canal`.

do $$
declare
  v_def text;
  v_novo text;
  v_ancora text;
begin

-- ------------------------------------------------- 1. baixa sem item
v_def := pg_get_functiondef('public.drenar_baixas(integer)'::regprocedure);

v_ancora := '    perform public.materializar_itens_da_baixa(v_baixa.id);';

if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
  raise exception 'ancora da materializacao aparece % vezes',
    (length(v_def) - length(replace(v_def, v_ancora, ''))) / nullif(length(v_ancora), 0);
end if;

v_novo := replace(v_def, v_ancora, v_ancora || '

    -- Zero itens: o anuncio nao tem SKU mapeado, e nao existe nada para
    -- baixar. Sem isto a baixa volta para a fila eternamente, sem erro e sem
    -- aviso, e a peca sai do galpao com o Bling achando que ela esta la.
    if not exists (
      select 1 from public.baixas_estoque_itens i where i.baixa_id = v_baixa.id
    ) then
      update public.baixas_estoque
         set situacao = ''erro'',
             tentativas = v_baixa.tentativas + 1,
             erro = ''Nenhum item para baixar: o anuncio deste pedido nao tem ''
                    ''SKU mapeado. Mapeie em Integracao e refaca a baixa.''
       where id = v_baixa.id;
      continue;
    end if;');

-- Expoente limitado, para a conta nao estourar o integer antes do teto valer.
v_ancora := 'make_interval(mins => power(3, v_baixa.tentativas + 1)::integer)';

if (length(v_novo) - length(replace(v_novo, v_ancora, ''))) / length(v_ancora) <> 1 then
  raise exception 'ancora da espera crescente nao bate';
end if;

v_novo := replace(v_novo, v_ancora,
  'make_interval(mins => power(3, least(v_baixa.tentativas + 1, 8))::integer)');

execute v_novo;

-- ------------------------------------- 2. filtro de cancelado que nao filtra
v_def := pg_get_functiondef('public.pedir_notas_ml(integer)'::regprocedure);

v_ancora := '      and p.cancelado_em is null';

if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
  raise exception 'ancora do cancelado nao bate';
end if;

v_novo := replace(v_def, v_ancora,
'      -- `cancelado_em` NUNCA e gravado por ninguem: a coluna existe e fica
      -- sempre nula, entao sozinha ela nao filtra nada. Quem sabe do
      -- cancelamento e `situacao_canal`, que vem do status do ML.
      and p.cancelado_em is null
      and coalesce(p.situacao_canal, '''') <> ''cancelled''');

execute v_novo;

end $$;
