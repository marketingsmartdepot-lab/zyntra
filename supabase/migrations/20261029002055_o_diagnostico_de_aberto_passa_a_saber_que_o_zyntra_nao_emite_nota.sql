-- Aberto e lista de problema, nao sala de espera.
--
-- A tela promete isso com as palavras dela: "So faturamento e SKU -- o que a
-- gente resolve no cadastro e reprocessa" e "Em operacao normal esta aba fica
-- vazia". Mas diagnosticar_pacote so sabia uma coisa: falta nota. Dai olhava a
-- conta, nao achava empresa emissora e concluia 'faturador_nao_configurado'.
--
-- Esse diagnostico esta errado hoje. O ZYNTRA nao emite nota: emissao_automatica
-- esta desligada nas duas contas, de proposito, porque quem emite e a Lexos. O
-- ZYNTRA le a nota de volta do ML (varrer_notas_ml). Nao existe faturador para
-- alguem configurar -- a tela mandava a pessoa consertar um cadastro que nao e
-- defeito. Medido em 28/10/2026: 14 de 14 pedidos em Aberto com essa causa
-- falsa, e nenhum deles tinha nota no ML (12 chamadas, 12 respostas 404
-- "Invoice not found").
--
-- Agora o diagnostico distingue tres situacoes:
--
--   1. emissao_automatica LIGADA e faturador faltando ou inativo
--      -> 'faturador_nao_configurado'. Isso continua sendo defeito real de
--         cadastro, e o texto nao muda.
--   2. emissao_automatica DESLIGADA e o ML ja liberou o envio (ready_to_ship)
--      -> 'sem_nota' com causa honesta: o ML esta esperando a nota e a Lexos
--         nao emitiu. Esse e o pedido que merece olho, com as horas paradas no
--         detalhe.
--   3. emissao_automatica DESLIGADA e o ML ainda nao liberou o envio
--      -> bloqueio nenhum. O pedido entrou agora e nao ha nada a fazer. Abrir
--         bloqueio aqui e a mesma mentira da anterior.
--
-- O pedido do caso 3 continua listado em Aberto -- a lista embaixo da tela
-- mostra ele --, so para de aparecer no painel de causas como se fosse defeito.
-- A tela ja trata esse caso: AbertoPorCausa recebe temPacotes e cala o
-- "Nada parado" quando ha pedido listado sem causa.
--
-- Nenhum tipo novo de bloqueio: usa 'sem_nota' e 'faturador_nao_configurado',
-- os dois que a resolucao no topo da funcao ja limpa quando a nota chega e que
-- pedidos_da_causa() ja aceita. Um tipo novo teria de entrar nos dois lugares,
-- e esquecer um deixaria o pedido preso em Aberto para sempre.

create or replace function public.diagnosticar_pacote(p_pacote_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_falta_nota boolean;
  v_tipo public.bloqueio_tipo;
  v_causa text;
  v_detalhe text;
  v_conta record;
begin
  -- Falta nota autorizada em algum pedido deste pacote?
  select exists (
    select 1
    from public.pacotes pa
    join public.pedidos p on p.envio_id = pa.envio_id
    left join public.notas_fiscais nf
      on nf.pedido_id = p.id and nf.situacao = 'autorizada'
    where pa.id = p_pacote_id and nf.id is null
  ) into v_falta_nota;

  if not v_falta_nota then
    -- Chegou nota para todos: o motivo fiscal deixou de existir.
    update public.bloqueios b
       set resolvido_em = now()
     where b.pacote_id = p_pacote_id
       and b.resolvido_em is null
       and b.tipo in ('sem_nota', 'faturador_nao_configurado');

    perform public.reavaliar_pacote(p_pacote_id);
    return;
  end if;

  select ct.apelido,
         ct.empresa_emissora_id,
         ct.emissao_automatica,
         em.nome_curto,
         coalesce(em.faturador_situacao, 'nao_configurado') as faturador,
         e.situacao_canal,
         round(extract(epoch from (now() - pa.etapa_desde))/3600, 1) as horas
    into v_conta
  from public.pacotes pa
  join public.contas ct on ct.id = pa.conta_id
  join public.envios e on e.id = pa.envio_id
  left join public.empresas em on em.id = ct.empresa_emissora_id
  where pa.id = p_pacote_id;

  -- A causa é o que a pessoa tem de consertar, e consertar uma vez libera
  -- todos os pedidos daquela conta. Por isso o texto é da CONFIGURAÇÃO, não
  -- do pedido.
  if v_conta.emissao_automatica
     and (v_conta.empresa_emissora_id is null or v_conta.faturador <> 'ativo') then
    v_tipo := 'faturador_nao_configurado';
    v_causa := 'Faturador do Mercado Livre não está ativo na conta';
    v_detalhe := case
      when v_conta.empresa_emissora_id is null
        then 'A conta ' || v_conta.apelido || ' ainda não tem empresa emissora definida.'
      else 'O Faturador da empresa ' || coalesce(v_conta.nome_curto, '?')
           || ' está como "' || v_conta.faturador || '".'
    end;

  elsif v_conta.emissao_automatica then
    -- O ZYNTRA pediu a nota e está esperando a autorização.
    v_tipo := 'sem_nota';
    v_causa := 'Aguardando a nota do Faturador do Mercado Livre';
    v_detalhe := 'A emissão foi pedida e a autorização ainda não voltou.';

  elsif v_conta.situacao_canal = 'ready_to_ship' then
    -- O ZYNTRA não emite nesta conta. O ML já liberou o envio e está
    -- esperando a nota: quem está devendo é o emissor de fora.
    v_tipo := 'sem_nota';
    v_causa := 'Esperando a nota fiscal — o Mercado Livre já liberou o envio';
    v_detalhe := 'O ZYNTRA não emite nota nesta conta; quem emite é a Lexos. '
              || 'O Mercado Livre já liberou o envio e está esperando a nota. '
              || 'Parado há ' || coalesce(v_conta.horas::text, '?') || ' h.';

  else
    -- O canal ainda não liberou o envio. Não há nota a esperar nem nada a
    -- corrigir: bloqueio aqui seria defeito inventado. O pedido continua
    -- listado em Aberto, só não entra no painel de causas.
    update public.bloqueios b
       set resolvido_em = now()
     where b.pacote_id = p_pacote_id
       and b.resolvido_em is null
       and b.tipo in ('sem_nota', 'faturador_nao_configurado');
    return;
  end if;

  -- A causa pode ter mudado (a empresa foi cadastrada, por exemplo): o
  -- bloqueio antigo sai para o novo entrar, senão a tela mostraria os dois.
  update public.bloqueios b
     set resolvido_em = now()
   where b.pacote_id = p_pacote_id
     and b.resolvido_em is null
     and b.tipo <> v_tipo
     and b.tipo in ('sem_nota', 'faturador_nao_configurado');

  if not exists (
    select 1 from public.bloqueios b
    where b.pacote_id = p_pacote_id and b.tipo = v_tipo and b.resolvido_em is null
  ) then
    insert into public.bloqueios (pacote_id, tipo, causa, detalhe)
    values (p_pacote_id, v_tipo, v_causa, v_detalhe);
  else
    -- Mantém o texto em dia sem reabrir o bloqueio.
    update public.bloqueios b
       set causa = v_causa, detalhe = v_detalhe
     where b.pacote_id = p_pacote_id and b.tipo = v_tipo and b.resolvido_em is null;
  end if;
end;
$function$;

-- Limpa as causas falsas que ficaram para tras. A varredura de notas chama
-- diagnosticar_pacote a cada cinco minutos, entao isto so antecipa o que ia
-- acontecer sozinho -- e e idempotente.
do $reconciliar$
declare v_pa uuid;
begin
  for v_pa in select id from public.pacotes where etapa = 'aberto' loop
    perform public.diagnosticar_pacote(v_pa);
  end loop;
end;
$reconciliar$;
