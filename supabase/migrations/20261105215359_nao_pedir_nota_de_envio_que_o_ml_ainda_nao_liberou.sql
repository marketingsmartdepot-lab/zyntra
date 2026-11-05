-- Nao pedir nota de pedido cujo envio o ML ainda nao liberou.
--
-- Medido em 05/11/2026, emitindo UM pedido de propósito (2000019281425862,
-- envio 48401290279, em pending/buffered ha 97 horas). O ML recusou:
--
--   10502 -- "shipment status is not ready_to_ship, shipped or delivered"
--
-- Ou seja: o ML amarra a nota ao estado do ENVIO, nao so ao pedido. Pedido
-- pago com envio em 'pending' nao pode ser faturado por ninguem -- nem pelo
-- ZYNTRA, nem pela Lexos. Nao e falha de sistema: e o ML segurando o envio.
--
-- Sem esta condicao o estrago nao e a chamada desperdicada, e o orfao:
-- pedir_notas_ml exclui pedido que tenha QUALQUER linha de nota --
--
--   and not exists (select 1 from notas_fiscais nf where nf.pedido_id = p.id)
--
-- -- e a recusa grava uma linha 'rejeitada'. Com isso o pedido sai da fila
-- automatica PARA SEMPRE: quando o ML liberar o envio, ninguem pede a nota, e
-- ele fica em Aberto esperando alguem clicar na tela. Nada avisa que ele saiu
-- da fila. Com os 21 pedidos em buffered de hoje, ligar a emissao em volume
-- criaria 21 orfaos numa tacada.
--
-- Com a condicao, nenhuma linha de nota nasce, o pedido continua limpo na
-- fila, e no primeiro ciclo depois de o ML liberar o envio ele e pedido
-- sozinho.
--
-- A FORMA e lista NEGRA de um item, no status, nao lista branca. O motivo e a
-- cicatriz de 20261027110639: lista branca de substatus barrou a Coleta
-- inteira e ninguem viu, porque bloqueio silencioso nao aparece em lugar
-- nenhum. Aqui, status que o ML inventar continua sendo tentado -- e se ele
-- recusar, a recusa aparece nomeada na aba Aberto. Falha visivel, nao muda.
--
-- Barra o STATUS 'pending', nao o substatus 'buffered': e status que o erro do
-- ML nomeia, e nos dados 'pending' so existe com 'buffered' (26 envios, zero
-- com outro substatus). Barrar o status cobre um 'pending/outra_coisa' futuro.
--
-- Os outros dois estados que o ML recusa -- 'cancelled' e 'not_delivered' --
-- nao entram aqui porque nao alcancam esta janela: reconciliar_envios_ml os
-- manda para Retidos, e Retidos esta fora de ('aberto','faturado').

create or replace function public.pedir_notas_ml(p_limite integer default 20)
 returns table(pedidas integer, motivo text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_url text;
  v_segredo text;
  v_p record;
  v_req bigint;
  n integer := 0;
begin
  select c.valor into v_url from privado.config c where c.chave = 'functions_url';
  select c.valor into v_segredo from privado.config c where c.chave = 'segredo_interno';

  if coalesce(v_url, '') = '' or coalesce(v_segredo, '') = '' then
    return query select 0, 'sem_configuracao';
    return;
  end if;

  for v_p in
    select p.id
    from public.pedidos p
    join public.contas ct on ct.id = p.conta_id
    join public.canais ca on ca.id = ct.canal_id
    join public.empresas em on em.id = ct.empresa_emissora_id
    join public.pacotes pa on pa.envio_id = p.envio_id
    join public.envios e on e.id = pa.envio_id
    where ca.slug = 'mercado_livre'
      and ct.situacao = 'conectada'
      and ct.emissao_automatica
      and ct.emissao_pausada_em is null
      and em.faturador_situacao = 'ativo'
      and p.pago_em is not null
      -- `cancelado_em` NUNCA e gravado por ninguem: a coluna existe e fica
      -- sempre nula, entao sozinha ela nao filtra nada. Quem sabe do
      -- cancelamento e `situacao_canal`, que vem do status do ML.
      and p.cancelado_em is null
      and coalesce(p.situacao_canal, '') <> 'cancelled'
      -- O ML recusa nota de envio que ele ainda nao liberou:
      -- 10502 "shipment status is not ready_to_ship, shipped or delivered".
      -- Pedir ali gera uma linha 'rejeitada' que tira o pedido desta fila
      -- para sempre (ver o `not exists` abaixo). Poupando, ele e pedido
      -- sozinho no primeiro ciclo depois de o ML liberar.
      and coalesce(e.situacao_canal, '') <> 'pending'
      and pa.etapa in ('aberto', 'faturado')
      and not exists (
        select 1 from public.notas_fiscais nf where nf.pedido_id = p.id
      )
      and not exists (
        select 1 from public.bloqueios b
        where b.pacote_id = pa.id
          and b.resolvido_em is null
          and b.tipo not in ('faturador_nao_configurado', 'sem_nota')
      )
    order by p.pago_em
    limit greatest(coalesce(p_limite, 20), 1)
  loop
    select net.http_post(
      url := v_url || '/nota',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-zyntra-segredo', v_segredo
      ),
      body := jsonb_build_object('pedido_id', v_p.id),
      timeout_milliseconds := 25000
    ) into v_req;

    n := n + 1;
  end loop;

  return query select n, 'ok';
end;
$function$;
