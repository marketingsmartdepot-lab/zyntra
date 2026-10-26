-- "Reprocessar": perguntar ao ML de novo o estado dos pedidos marcados.
--
-- O caso da Daniele, textual: "a etiqueta nao caiu ainda no sistema, mas ja ta
-- liberada no ML". Fui ver por que isso acontece e o motivo e preciso.
--
-- `pedir_etiquetas_ml` roda de 5 em 5 minutos e reinsiste a cada 10 por envio,
-- para sempre — mas so pede quando a COPIA que o ZYNTRA tem do estado diz que
-- da:
--
--   situacao_canal = 'ready_to_ship'
--   substatus      in ('ready_to_print', 'printed')
--
-- Se essa copia estiver atrasada — aviso de webhook perdido, varredura parada
-- — o ML ja liberou a etiqueta e o ZYNTRA NEM TENTA pedir, porque pela copia
-- dele ainda nao e hora. E a condicao nao vira verdadeira sozinha: quem a
-- atualizaria e justamente o aviso que se perdeu. A caixa fica parada para
-- sempre com a etiqueta disponivel do outro lado.
--
-- E o mesmo defeito das caixas penduradas em Pronto de 23/10, numa terceira
-- roupa: uma decisao tomada sobre uma copia desatualizada do que o canal diz.
--
-- Reprocessar refaz a copia. Nao imprime nada e nao pede etiqueta: atualiza o
-- estado, e quem pede e o cron de sempre, no minuto seguinte, agora que a
-- condicao e verdadeira. Uma funcao faz uma coisa.
--
-- As regras de etapa sao as MESMAS do caminho automatico
-- (`envio_saiu_do_galpao` / `envio_chegou_no_cliente`), de proposito: duas
-- copias da mesma decisao divergem, e ja divergiram duas vezes neste sistema.

-- ------------------------------------------- a permissao, propria e separada
-- Separada de `alterar_etapa` porque sao riscos diferentes: alterar etapa fura
-- a esteira e exige motivo; reprocessar so pergunta ao canal e nao inventa
-- nada. Quem esta na bancada precisa destravar uma etiqueta sem poder mover
-- caixa de lugar.
create or replace function public.permissoes_possiveis()
returns table (chave text, grupo text, rotulo text, descricao text, onde text, ordem integer)
language sql
stable
set search_path to ''
as $function$
  select * from (values
    ('ver_painel',      'Enxergar', 'Painel',
     'Os números do dia e o que está parado.', 'perfil', 1),
    ('ver_expedicao',   'Enxergar', 'Expedição',
     'A esteira: Aberto, Faturado, Separar, Conferir, Pronto.', 'perfil', 2),
    ('ver_logistica',   'Enxergar', 'Logística',
     'Doca, saída e o fechamento do Flex.', 'perfil', 3),
    ('ver_catalogo',    'Enxergar', 'Catálogo',
     'Os produtos que vieram do Bling.', 'perfil', 4),
    ('ver_integracao',  'Enxergar', 'Integração',
     'Contas, impressoras e pessoas.', 'perfil', 5),
    ('ver_valores',     'Enxergar', 'Valores e custos',
     'Preço do pedido e custo de envio. Sem isto, as colunas de dinheiro somem.', 'perfil', 6),

    ('mexer_integracao','Fazer',    'Conectar contas e impressoras',
     'Ligar conta do Mercado Livre, trocar credencial, mexer em impressora.', 'perfil', 10),
    ('mexer_catalogo',  'Fazer',    'Mexer no catálogo',
     'Apagar produto, restaurar ignorado, sincronizar com o Bling.', 'perfil', 11),
    ('mexer_equipe',    'Fazer',    'Mexer nas pessoas',
     'Cadastrar gente, tirar acesso, mudar o que cada uma pode.', 'perfil', 12),
    ('gerar_lista',     'Fazer',    'Gerar lista de separação',
     'Fechar um lote em Separar e mandar para Conferir.', 'perfil', 13),
    ('reter_pedido',    'Fazer',    'Reter e devolver pedido',
     'Tirar da esteira quando o problema é do canal, e trazer de volta.', 'perfil', 14),
    ('bipar_por_sku',   'Fazer',    'Conferir digitando o SKU',
     'Quando o produto não tem código de barras. Bipar lê o que está na caixa; digitar é alguém afirmando o que está.', 'perfil', 15),
    ('reiniciar_conferencia','Fazer','Reiniciar conferência',
     'Zerar uma conferência em andamento. Apaga as leituras já feitas.', 'perfil', 16),
    ('alterar_etapa',   'Fazer',    'Alterar a etapa na mão',
     'Mover a caixa para qualquer etapa, furando o caminho normal da esteira. Exige motivo escrito, e o motivo fica no histórico da caixa.', 'perfil', 17),
    ('reprocessar_pedido','Fazer',  'Reprocessar pedido',
     'Perguntar ao canal de novo o estado do pedido. Destrava etiqueta que o Mercado Livre já liberou mas que o ZYNTRA ainda não enxergou.', 'perfil', 18)
  ) as t(chave, grupo, rotulo, descricao, onde, ordem)
  order by ordem;
$function$;

-- ------------------------------------------------------------- reprocessar
create or replace function public.reprocessar_pacotes(p_pacote_ids uuid[])
returns table (
  ok boolean, motivo text,
  olhados integer, atualizados integer, moveram integer, falhas integer
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_p record;
  v_token text;
  v_conta uuid;
  v_http extensions.http_response;
  v_status text;
  v_sub text;
  v_pedido text;
  n_olh integer := 0; n_att integer := 0; n_mov integer := 0; n_fal integer := 0;
begin
  if not public.pode('reprocessar_pedido') then
    return query select false, 'sem_permissao', 0,0,0,0; return;
  end if;

  if p_pacote_ids is null or array_length(p_pacote_ids, 1) is null then
    return query select false, 'nada_selecionado', 0,0,0,0; return;
  end if;

  -- Teto por chamada: 28 contas e alguem marcando "todos" numa aba de 300
  -- caixas viraria 600 chamadas ao ML de uma vez, e o ML responde 429.
  if array_length(p_pacote_ids, 1) > 60 then
    return query select false, 'demais_de_uma_vez', 0,0,0,0; return;
  end if;

  foreach v_id in array p_pacote_ids loop
    select pa.id as pacote_id, pa.etapa::text as etapa, pa.conta_id,
           e.id as envio_id, e.ref_externa,
           (select p.ref_externa from public.pedidos p
             where p.envio_id = e.id limit 1) as pedido_ref
      into v_p
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    where pa.id = v_id;

    if not found or coalesce(v_p.ref_externa, '') = '' then
      n_fal := n_fal + 1;
      continue;
    end if;

    if v_conta is distinct from v_p.conta_id then
      v_conta := v_p.conta_id;
      select t.token into v_token from privado.token_ml(v_conta) t;
    end if;

    if coalesce(v_token, '') = '' then
      n_fal := n_fal + 1;
      continue;
    end if;

    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
      select * into v_http from extensions.http((
        'GET',
        'https://api.mercadolibre.com/shipments/'
          || extensions.urlencode(v_p.ref_externa) || '?fields=status,substatus',
        array[extensions.http_header('Accept','application/json'),
              extensions.http_header('Authorization','Bearer ' || v_token)],
        null, null)::extensions.http_request);
    exception when others then
      n_fal := n_fal + 1;
      continue;
    end;

    if v_http.status = 429 then
      -- Barrados por excesso: devolver o que deu ate aqui vale mais que
      -- insistir e levar bloqueio maior.
      return query select true, 'parou_no_limite_do_ml', n_olh, n_att, n_mov, n_fal;
      return;
    end if;

    if v_http.status <> 200 then
      n_fal := n_fal + 1;
      continue;
    end if;

    n_olh := n_olh + 1;
    v_status := (v_http.content::jsonb)->>'status';
    v_sub := (v_http.content::jsonb)->>'substatus';

    update public.envios
       set situacao_canal = coalesce(v_status, situacao_canal),
           substatus_canal = v_sub,
           atualizado_em = now()
     where id = v_p.envio_id
       and (situacao_canal is distinct from v_status
            or substatus_canal is distinct from v_sub);

    if found then n_att := n_att + 1; end if;

    -- O estado do PEDIDO tambem: e ele que dispara Retidos e o estorno da
    -- baixa quando o ML cancela.
    if coalesce(v_p.pedido_ref, '') <> '' then
      begin
        perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
        select * into v_http from extensions.http((
          'GET',
          'https://api.mercadolibre.com/orders/'
            || extensions.urlencode(v_p.pedido_ref) || '?attributes=id,status',
          array[extensions.http_header('Accept','application/json'),
                extensions.http_header('Authorization','Bearer ' || v_token)],
          null, null)::extensions.http_request);

        if v_http.status = 200 then
          v_pedido := (v_http.content::jsonb)->>'status';

          update public.pedidos
             set situacao_canal = v_pedido, atualizado_em = now()
           where envio_id = v_p.envio_id
             and v_pedido is not null
             and situacao_canal is distinct from v_pedido;
        end if;
      exception when others then
        null;  -- o estado do envio ja foi atualizado; isto e extra
      end;
    end if;

    -- As MESMAS regras do caminho automatico. Nao reescrevo a decisao aqui.
    if public.envio_chegou_no_cliente(v_status, v_sub)
       and v_p.etapa <> 'entregue' then

      update public.pacotes set etapa = 'entregue' where id = v_p.pacote_id;

      insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe, por)
      values (v_p.pacote_id, 'reprocessamento', v_p.etapa, 'entregue',
              'Reprocessado a pedido: o Mercado Livre diz que foi entregue.',
              auth.uid());

      n_mov := n_mov + 1;

    elsif public.envio_saiu_do_galpao(v_status, v_sub)
          and v_p.etapa in ('aberto','faturado','separar','conferir','pronto') then

      update public.pacotes set etapa = 'enviado' where id = v_p.pacote_id;

      insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe, por)
      values (v_p.pacote_id, 'reprocessamento', v_p.etapa, 'enviado',
              'Reprocessado a pedido: o Mercado Livre diz "'
              || coalesce(v_status,'?') || coalesce(' / ' || v_sub, '')
              || '", esta caixa ja saiu do galpao.',
              auth.uid());

      n_mov := n_mov + 1;
    end if;
  end loop;

  return query select true, 'ok', n_olh, n_att, n_mov, n_fal;
end;
$function$;

comment on function public.reprocessar_pacotes is
  'Pergunta ao ML de novo o estado dos pacotes marcados e atualiza a copia '
  'local. NAO pede etiqueta: quem pede e o cron, no minuto seguinte, agora '
  'que a condicao dele e verdadeira. Exige a permissao reprocessar_pedido.';

revoke all on function public.reprocessar_pacotes(uuid[]) from public, anon;
grant execute on function public.reprocessar_pacotes(uuid[]) to authenticated;
