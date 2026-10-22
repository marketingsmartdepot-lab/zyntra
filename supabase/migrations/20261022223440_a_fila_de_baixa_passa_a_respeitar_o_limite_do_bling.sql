-- O Bling limita requisições por segundo. Eu tomei um 429 testando, com
-- quatro chamadas em dois segundos. A fila dispara em rajada: `p_limite`
-- contava BAIXAS, e uma baixa de oito itens são oito chamadas — então o
-- limite não limitava o que importa.
--
-- Com uma conta e sete vendas por dia isso nunca aparece. Com 28 contas
-- aparece todo dia, e aí o estoque no Bling fica atrasado em relação à venda
-- por causa da espera crescente. Que é justamente o que a baixa na hora da
-- venda existe para evitar: anúncio republicando saldo velho.
--
-- POR QUE NÃO RESOLVE COM PAUSA. `net.http_post` apenas ENFILEIRA; quem manda
-- é o trabalhador do pg_net, depois do commit. Dormir entre as chamadas não
-- espaça nada — elas saem juntas do mesmo jeito. O único controle real é
-- quantas se enfileira por rodada.
--
-- Então `p_limite` passa a contar CHAMADAS, e o cron passa de 20 a cada dois
-- minutos para 2 a cada minuto. São 120 chamadas por hora; o pico estimado
-- com 28 contas é um terço disso.
--
-- E a baixa que para no meio por causa do limite NÃO leva espera crescente:
-- ela não falhou, só não coube. Sem isto ela esperaria 3, depois 9, depois 27
-- minutos para mandar o resto dos próprios itens — a trava de ritmo viraria
-- lentidão de verdade.

create or replace function public.drenar_baixas(p_limite integer default 2)
returns table (baixas integer, chamadas integer, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ativo boolean;
  v_token text;
  v_baixa record;
  v_item record;
  v_n_baixas integer := 0;
  v_n_chamadas integer := 0;
  v_teto integer := greatest(coalesce(p_limite, 2), 1);
  v_parou_por_limite boolean := false;
  v_req bigint;
begin
  select c.ativo into v_ativo from public.erp_config c where c.id;

  if not coalesce(v_ativo, false) then
    return query select 0, 0, 'envio_desligado';
    return;
  end if;

  select ce.access_token into v_token from privado.credenciais_erp ce where ce.id;

  if coalesce(v_token, '') = '' then
    return query select 0, 0, 'sem_credencial';
    return;
  end if;

  for v_baixa in
    select b.id, b.tipo, b.deposito_ref, b.tentativas,
           (select p.ref_externa from public.pedidos p where p.id = b.pedido_id)
             as pedido_no_canal
    from public.baixas_estoque b
    where b.situacao = 'pendente'
      and b.tentar_apos <= now()
      -- Estorno sempre sai: peca que saiu da prateleira tem que voltar.
      -- Baixa so sai se a conta continuar ligada.
      and (b.tipo = 'estorno' or exists (
        select 1 from public.pedidos p
        join public.contas ct on ct.id = p.conta_id
        where p.id = b.pedido_id and ct.baixa_estoque_automatica
      ))
    order by b.criada_em
    -- Folga sobre o teto de chamadas: a maioria das baixas tem um item so, e
    -- quem manda parar e o contador de chamadas, nao este limite.
    limit v_teto * 3
    for update skip locked
  loop
    exit when v_parou_por_limite;

    if coalesce(v_baixa.deposito_ref, '') = '' then
      update public.baixas_estoque
         set situacao = 'erro',
             erro = 'Nenhum deposito configurado quando esta baixa foi enfileirada.',
             tentativas = v_baixa.tentativas + 1
       where id = v_baixa.id;
      continue;
    end if;

    perform public.materializar_itens_da_baixa(v_baixa.id);

    -- Zero itens: o anuncio nao tem SKU mapeado, e nao existe nada para
    -- baixar. Sem isto a baixa volta para a fila eternamente, sem erro e sem
    -- aviso, e a peca sai do galpao com o Bling achando que ela esta la.
    if not exists (
      select 1 from public.baixas_estoque_itens i where i.baixa_id = v_baixa.id
    ) then
      update public.baixas_estoque
         set situacao = 'erro',
             tentativas = v_baixa.tentativas + 1,
             erro = 'Nenhum item para baixar: o anuncio deste pedido nao tem '
                    'SKU mapeado. Mapeie em Integracao e refaca a baixa.'
       where id = v_baixa.id;
      continue;
    end if;

    -- SKU sem referencia no Bling nao tem como baixar. Dizer qual, em vez de
    -- somir com a peca da conta.
    if exists (
      select 1 from public.baixas_estoque_itens i
      where i.baixa_id = v_baixa.id and coalesce(i.erp_ref, '') = ''
    ) then
      update public.baixas_estoque
         set situacao = 'erro',
             tentativas = v_baixa.tentativas + 1,
             erro = 'SKU sem referencia no Bling: ' || (
               select string_agg(s.codigo, ', ')
               from public.baixas_estoque_itens i
               join public.skus s on s.id = i.sku_id
               where i.baixa_id = v_baixa.id and coalesce(i.erp_ref, '') = ''
             )
       where id = v_baixa.id;
      continue;
    end if;

    v_n_baixas := v_n_baixas + 1;

    for v_item in
      select i.id, i.erp_ref, i.quantidade
      from public.baixas_estoque_itens i
      where i.baixa_id = v_baixa.id and i.situacao in ('pendente', 'erro')
    loop
      exit when v_n_chamadas >= v_teto;

      select net.http_post(
        url := 'https://api.bling.com.br/Api/v3/estoques',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_token,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'produto', jsonb_build_object('id', v_item.erp_ref),
          'deposito', jsonb_build_object('id', v_baixa.deposito_ref),
          -- 'S' tira da prateleira, 'E' devolve.
          'operacao', case when v_baixa.tipo = 'estorno' then 'E' else 'S' end,
          'quantidade', v_item.quantidade,
          -- A coluna Origem do Bling e dele: ali vai o documento que gerou o
          -- movimento, e movimento direto nao tem documento. Esta observacao
          -- e o unico lugar onde da para dizer de onde isto veio.
          'observacoes',
            case when v_baixa.tipo = 'estorno' then 'ZYNTRA estorno' else 'ZYNTRA' end
            || coalesce(' · pedido ML ' || v_baixa.pedido_no_canal, '')
        ),
        timeout_milliseconds := 15000
      ) into v_req;

      update public.baixas_estoque_itens
         set situacao = 'enviando', request_id = v_req, erro = null
       where id = v_item.id;

      v_n_chamadas := v_n_chamadas + 1;
    end loop;

    -- Sobrou item desta baixa por causa do teto? Ela nao falhou, so nao
    -- coube. Fica pronta para a rodada seguinte, sem espera e sem gastar
    -- tentativa — senao o ritmo viraria lentidao.
    if exists (
      select 1 from public.baixas_estoque_itens i
      where i.baixa_id = v_baixa.id and i.situacao in ('pendente', 'erro')
    ) then
      v_parou_por_limite := true;
      update public.baixas_estoque
         set tentar_apos = now()
       where id = v_baixa.id;
    else
      update public.baixas_estoque
         set tentativas = v_baixa.tentativas + 1,
             -- Espera crescente, teto de uma hora.
             tentar_apos = now() + least(
               make_interval(mins => power(3, least(v_baixa.tentativas + 1, 8))::integer),
               interval '1 hour'
             )
       where id = v_baixa.id;
    end if;
  end loop;

  return query select v_n_baixas, v_n_chamadas, 'ok'::text;
end;
$$;

comment on function public.drenar_baixas is
  'Manda as baixas pendentes ao Bling. `p_limite` conta CHAMADAS por rodada, '
  'nao baixas: e o que respeita o limite por segundo do Bling. Baixa que nao '
  'coube no teto volta na rodada seguinte, sem espera.';

-- De 20 a cada dois minutos (rajada) para 2 a cada minuto (ritmo).
select cron.unschedule('zyntra-drena-baixas');
select cron.schedule('zyntra-drena-baixas', '* * * * *',
                     $$ select public.drenar_baixas(2) $$);
