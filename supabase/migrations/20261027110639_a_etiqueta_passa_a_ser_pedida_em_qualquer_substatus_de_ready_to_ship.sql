-- A Daniele viu 9 caixas paradas em Faturado e perguntou por que o ZPL nao
-- desce. Nao descia porque nunca foi pedido.
--
-- Esta funcao tinha uma lista branca de dois substatus, com um comentario
-- afirmando que "o ML so entrega nestes estados". A afirmacao e falsa. Pedi a
-- etiqueta do envio 48353979897 (Coleta, ready_for_pickup, parada em Faturado)
-- direto na API do ML em 27/10/2026:
--
--   GET /shipment_labels?shipment_ids=48353979897&response_type=zpl2
--   -> HTTP 200 · application/zip · comeca com PK
--
-- O ML entrega. A lista branca barrava uma chamada que funciona.
--
-- E ela barrava a Coleta INTEIRA, porque ready_for_pickup e o estado de
-- repouso dela. A linha do tempo de uma caixa mostra por que nao era azar:
--
--   19:36:14  ML libera        ready_to_print   OK   etapa aberto    nao
--   20:39:59  Lexos imprime    printed          OK   etapa aberto    nao
--   20:40:01  ML avanca        ready_for_pickup NAO  etapa aberto    nao
--   20:42:00  nota autoriza    ready_for_pickup NAO  etapa FATURADO  nao
--
-- As duas janelas nunca se cruzam. A do substatus fecha as 20:40:01; a da
-- etapa abre as 20:42:00. Esses dois minutos sao a ordem de trabalho da Lexos,
-- que imprime a etiqueta antes de faturar. Em 7 das 9 caixas a etapa abriu de
-- 90 a 268 segundos depois da impressao.
--
-- O preco era alto e silencioso: sem etiqueta_pedida_em e sem etiqueta_erro,
-- parecia que nada havia acontecido, em vez de ter falhado. E sem ZPL a caixa
-- nao sai de Faturado -- e coletar_etiquetas_ml que a move -- e o bipe da
-- bancada recusa com "sem etiqueta". Ou seja: a esteira travava e a etiqueta
-- nao saia no bipe, as duas coisas pela mesma linha de codigo.
--
-- Agora quem diz que nao da e o ML, nao um palpite nosso: quando ele recusa,
-- coletar_etiquetas_ml() grava a resposta em etiqueta_erro. Assim um substatus
-- novo nunca mais barra calado -- e eles aparecem: 'invoice_pending' surgiu
-- numa caixa de Coleta em 27/10.
--
-- Fica de fora de proposito: a janela de etapas segue 'faturado', 'separar',
-- 'conferir'. Ha uma caixa Flex em 'aberto' com etiqueta ja impressa no ML,
-- mas pedir antes da nota autorizada muda a regra da esteira, e isso ela ainda
-- nao decidiu.

create or replace function public.pedir_etiquetas_ml(p_limite integer default 20)
returns table(pedidas integer, sem_endereco boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_base text;
  v_segredo text;
  v_e record;
  v_token text;
  v_req bigint;
  n integer := 0;
begin
  select c.valor into v_base from privado.config c where c.chave = 'app_url';
  select c.valor into v_segredo from privado.config c where c.chave = 'segredo_interno';

  if coalesce(v_base, '') = '' or coalesce(v_segredo, '') = '' then
    return query select 0, true; return;
  end if;

  for v_e in
    select e.id, e.ref_externa, e.conta_id
    from public.envios e
    join public.pacotes pa on pa.envio_id = e.id
    join public.contas ct on ct.id = e.conta_id
    join public.canais ca on ca.id = ct.canal_id
    where ca.slug = 'mercado_livre'
      and ct.situacao = 'conectada'
      and pa.etapa in ('faturado', 'separar', 'conferir')
      and e.etiqueta_conteudo is null
      -- O ML entrega a etiqueta em qualquer substatus de ready_to_ship.
      -- Havia aqui uma lista branca ('ready_to_print', 'printed') que barrava
      -- a Coleta inteira: ela descansa em 'ready_for_pickup', e nesse estado
      -- o ML responde 200 com a etiqueta. Se ele recusar,
      -- coletar_etiquetas_ml() grava a recusa em etiqueta_erro -- um substatus
      -- novo nao barra calado.
      and e.situacao_canal = 'ready_to_ship'
      -- Não repetir enquanto a resposta anterior não voltou.
      and (e.etiqueta_pedida_em is null
           or e.etiqueta_pedida_em < now() - interval '10 minutes')
    order by e.etiqueta_pedida_em nulls first
    limit greatest(coalesce(p_limite, 20), 1)
  loop
    select t.token into v_token from privado.token_ml(v_e.conta_id) t;
    continue when coalesce(v_token, '') = '';

    select net.http_post(
      url := v_base || '/api/ml/etiquetas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-zyntra-segredo', v_segredo
      ),
      body := jsonb_build_object(
        'envio_id', v_e.id,
        'shipment_id', v_e.ref_externa,
        'token', v_token
      ),
      timeout_milliseconds := 20000
    ) into v_req;

    update public.envios e
       set etiqueta_request_id = v_req,
           etiqueta_pedida_em = now(),
           etiqueta_erro = null
     where e.id = v_e.id;

    n := n + 1;
  end loop;

  return query select n, false;
end;
$function$;
