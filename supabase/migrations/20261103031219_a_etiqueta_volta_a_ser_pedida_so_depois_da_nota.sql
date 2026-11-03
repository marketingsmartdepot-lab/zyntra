-- A etiqueta volta a ser pedida so depois de o pedido estar faturado.
--
-- Isto DESFAZ a migration 20261027141544, de proposito. Naquele dia a premissa
-- era outra: a Lexos faturava por fora, o pedido ficava ~11h em Aberto
-- esperando a nota aparecer no ML, e nesse meio-tempo o ML as vezes ja tinha
-- liberado a etiqueta. Buscar desde Aberto adiantava trabalho de graca.
--
-- Essa premissa morreu em 03/11/2026, quando o ZYNTRA passou a emitir a nota
-- pelo Faturador do ML. Agora o ML NUNCA libera a etiqueta antes da nota: ele
-- segura o envio em 'invoice_pending' justamente esperando por ela. Pedir em
-- Aberto passou a fazer tres coisas, todas ruins:
--
--   1. queima chamada ao ML para receber 400;
--   2. grava a recusa em etiqueta_erro, e a tela mostra defeito onde nao ha;
--   3. liga a trava de 10 minutos de etiqueta_pedida_em.
--
-- A (3) e a pior, e custou o teste de hoje. Sequencia medida no pedido
-- 2000019218896500:
--
--   02:58:00  etiqueta pedida   -> envio em invoice_pending, ML recusou
--   03:03:07  nota emitida
--   03:03:08  pedido vai para Faturado
--   03:04:12  SEFAZ autoriza    -> ML libera a etiqueta
--   03:08:00  so agora a trava de 10 min vence e o ZYNTRA pode pedir
--
-- Quatro minutos de espera inventada, por uma recusa que aconteceu antes de a
-- nota existir. Com 16 pedidos em Faturado, 10 estavam em invoice_pending
-- levando recusa a cada ciclo.
--
-- Duas condicoes consertam:
--
--   a) a janela volta a 'faturado', 'separar', 'conferir' -- sem 'aberto';
--   b) nao pedir enquanto o substatus for 'invoice_pending', porque ai o
--      proprio ML ja disse que nao entrega.
--
-- Juntas, o primeiro pedido de etiqueta acontece quando o pedido ja esta
-- faturado E o ML ja saiu de invoice_pending: sem recusa e sem trava.
--
-- A lista branca de substatus NAO volta. Ela foi removida em 20261027110639
-- porque barrava a Coleta inteira, que descansa em 'ready_for_pickup' -- e
-- naquele estado o ML entrega a etiqueta (HTTP 200 + ZIP, conferido). Aqui o
-- que entra e uma lista NEGRA de um item so, do unico substatus em que o ML
-- disse explicitamente que nao entrega.

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
      -- Depois da nota, nunca antes. O ML nao libera a etiqueta de pedido sem
      -- nota, entao pedir em 'aberto' so gasta chamada e liga a trava de 10
      -- minutos abaixo, atrasando a etiqueta de verdade.
      and pa.etapa in ('faturado', 'separar', 'conferir')
      and e.etiqueta_conteudo is null
      -- Sem lista branca de substatus: a Coleta descansa em
      -- 'ready_for_pickup' e o ML entrega a etiqueta nesse estado.
      and e.situacao_canal = 'ready_to_ship'
      -- Lista negra de um item: em 'invoice_pending' o ML esta esperando a
      -- nota e responde 400 'ainda_nao_pode_imprimir'. Pedir ali e pedir para
      -- levar nao.
      and coalesce(e.substatus_canal, '') <> 'invoice_pending'
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

-- Limpa o rastro das recusas que a regra antiga provocou. Sem isto, os
-- pedidos que tomaram 'ainda_nao_pode_imprimir' continuam com erro na tela e,
-- pior, presos na trava de 10 minutos -- esperando por uma recusa que a regra
-- nova nao teria causado.
update public.envios e
   set etiqueta_erro = null,
       etiqueta_pedida_em = null,
       etiqueta_request_id = null
 where e.etiqueta_conteudo is null
   and e.etiqueta_erro like '%ainda_nao_pode_imprimir%';
