-- Ela olhou o histórico do produto no Bling e perguntou: "no origem não dá pra
-- colocar que o movimento foi do ZYNTRA?"
--
-- A coluna ORIGEM não dá: ali o Bling põe o DOCUMENTO que gerou o movimento
-- ("V 102296", clicável, a venda). Movimento de estoque direto não tem
-- documento, então ela fica vazia. É o preço de mandar movimento em vez de
-- criar o pedido — e vai ser assim em todos, para sempre.
--
-- A coluna OBSERVAÇÃO dá. Testei contra o Bling: ele aceita `observacoes` no
-- corpo e devolve 201. Não consegui confirmar pela API que o campo é
-- realmente usado — não existe endpoint de leitura de movimento (404 em
-- /estoques/{id} e em /produtos/{id}/estoques) — então quem confirma é ela na
-- tela. Se o Bling estiver ignorando, isto não faz mal nenhum; se usar, cada
-- linha passa a dizer de qual venda do ML ela veio.
--
-- O número do pedido no ML é o que importa ali: é por ele que se acha a venda
-- de novo, tanto no ZYNTRA quanto no painel do Mercado Livre.

do $$
declare
  v_def text;
  v_novo text;
  v_ancora text;
begin
  v_def := pg_get_functiondef('public.drenar_baixas(integer)'::regprocedure);

  -- 1. O laço passa a trazer o número do pedido no canal.
  v_ancora := '    select b.id, b.tipo, b.deposito_ref, b.tentativas
    from public.baixas_estoque b';

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'ancora do laco nao bate';
  end if;

  v_novo := replace(v_def, v_ancora,
'    select b.id, b.tipo, b.deposito_ref, b.tentativas,
           (select p.ref_externa from public.pedidos p where p.id = b.pedido_id)
             as pedido_no_canal
    from public.baixas_estoque b');

  -- 2. O corpo leva a observação.
  v_ancora := '          ''quantidade'', v_item.quantidade
        ),';

  if (length(v_novo) - length(replace(v_novo, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'ancora do corpo nao bate';
  end if;

  v_novo := replace(v_novo, v_ancora,
'          ''quantidade'', v_item.quantidade,
          -- A coluna Origem do Bling e dele: ali vai o documento que gerou o
          -- movimento, e movimento direto nao tem documento. Esta observacao
          -- e o unico lugar onde da para dizer de onde isto veio.
          ''observacoes'',
            case when v_baixa.tipo = ''estorno'' then ''ZYNTRA estorno'' else ''ZYNTRA'' end
            || coalesce('' · pedido ML '' || v_baixa.pedido_no_canal, '''')
        ),');

  execute v_novo;
end $$;

comment on function public.drenar_baixas is
  'Manda as baixas pendentes ao Bling, uma chamada por item, com observacao '
  'dizendo de qual venda do ML o movimento veio.';
