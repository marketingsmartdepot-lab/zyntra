-- A busca da etiqueta deixa de esperar a nota fiscal.
--
-- Hoje o ZYNTRA nao emite nota: nenhuma conta tem empresa emissora e
-- emissao_automatica esta desligada nas duas. Quem emite e a Lexos; o ZYNTRA
-- le a nota no ML e so entao o pedido sai de 'aberto'. Medido em 27/10/2026:
-- dos 187 bloqueios 'faturador_nao_configurado' abertos desde 26/09, 182 se
-- resolveram sozinhos (resolvido_por nulo) e 182 de 182 terminaram com nota
-- autorizada -- media de 667 minutos entre abrir e resolver.
--
-- Ou seja: o pedido fica ~11 horas em 'aberto' esperando a nota da Lexos. Se o
-- ML liberou a etiqueta nesse meio-tempo -- como no 48357483818, que esta em
-- ready_to_ship/printed sem ZPL no ZYNTRA desde 26/10 23:55 -- o ZYNTRA passa
-- essas horas com a etiqueta disponivel no ML e sem buscar, so porque a janela
-- da busca exigia etapa 'faturado'.
--
-- Baixar o ZPL nao imprime nada e nao move a esteira: quem move
-- 'faturado' -> 'separar' e coletar_etiquetas_ml(), e essa regra nao muda --
-- continua exigindo nota autorizada e zero bloqueios. O pedido ganha a
-- etiqueta e continua parado em Aberto, como deve ser.
--
-- Unica mudanca funcional: 'aberto' entra na janela de etapas.

CREATE OR REPLACE FUNCTION public.pedir_etiquetas_ml(p_limite integer DEFAULT 20)
 RETURNS TABLE(pedidas integer, sem_endereco boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- 'aberto' entra aqui: o ML pode liberar a etiqueta horas antes da nota
      -- da Lexos chegar, e nao ha motivo para esperar. Baixar o ZPL nao
      -- imprime e nao anda a esteira -- quem move 'faturado' -> 'separar' e
      -- coletar_etiquetas_ml(), que continua exigindo nota autorizada e zero
      -- bloqueios.
      and pa.etapa in ('aberto', 'faturado', 'separar', 'conferir')
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
