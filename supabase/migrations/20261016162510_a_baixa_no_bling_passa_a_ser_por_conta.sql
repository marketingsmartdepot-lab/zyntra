-- Eu construí um interruptor só, global, e ela vai migrar CONTA POR CONTA,
-- desligando a Lexos de uma e deixando as outras como estão. Com interruptor
-- global, ligar causaria baixa dupla em toda conta que ainda não migrou: a
-- Lexos baixando e o ZYNTRA baixando a mesma peça.
--
-- Isso já estava nas decisões dela desde 22/09 — "corte da Lexos por CNPJ,
-- conforme migra, nunca por lote" — e eu construí contra.
--
-- Agora são dois níveis, a mesma forma que a emissão da nota já tem:
--
--   contas.baixa_estoque_automatica  -> por conta. É o que ela liga quando
--                                       desliga a Lexos daquela conta.
--   erp_config.ativo                 -> geral. Botão de pânico: desliga TODAS
--                                       de uma vez sem mexer em 28 contas.
--
-- O geral volta para ligado, porque todas as contas nascem desligadas e nada
-- dispara. Assim ela tem UM clique por conta, em vez de lembrar de dois
-- interruptores e achar que está quebrado.

alter table public.contas
  add column if not exists baixa_estoque_automatica boolean not null default false;

comment on column public.contas.baixa_estoque_automatica is
  'Se o ZYNTRA baixa o estoque desta conta no Bling. Liga quando a Lexos '
  'parar de mandar os pedidos DESTA conta — os dois juntos baixam duas vezes.';

/**
 * Enfileira a baixa quando a venda chega, e o estorno quando ela é cancelada.
 *
 * Duas travas para enfileirar, e as duas existem para o mesmo motivo: fila
 * guardada é baixa dupla esperando a hora. Se a conta não migrou, ou se o
 * geral está desligado, a venda passa sem deixar nada na fila.
 */
create or replace function public.enfileirar_baixa_do_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_geral boolean;
  v_deposito text;
  v_da_conta boolean;
begin
  select c.ativo, c.deposito_ref into v_geral, v_deposito
  from public.erp_config c where c.id;

  -- A venda chegou.
  if tg_op = 'INSERT' then
    if coalesce(new.situacao_canal, '') = 'cancelled' then
      return new;
    end if;

    select ct.baixa_estoque_automatica into v_da_conta
    from public.contas ct where ct.id = new.conta_id;

    if not coalesce(v_geral, false) or not coalesce(v_da_conta, false) then
      return new;
    end if;

    insert into public.baixas_estoque (pedido_id, tipo, deposito_ref)
    values (new.id, 'baixa', v_deposito)
    on conflict (pedido_id, tipo) do nothing;

    return new;
  end if;

  -- A venda foi cancelada. Só devolve o que REALMENTE saiu: se a baixa não
  -- chegou a ser enviada, não há nada para estornar, e mandar um estorno
  -- sozinho criaria estoque que nunca existiu.
  --
  -- Sem nenhuma das duas travas aqui, de propósito: peça que já saiu da
  -- prateleira do Bling tem que voltar mesmo que alguém desligue a conta ou o
  -- geral no meio do caminho.
  if coalesce(new.situacao_canal, '') = 'cancelled'
     and coalesce(old.situacao_canal, '') is distinct from 'cancelled' then

    declare
      v_dep_da_baixa text;
    begin
      select b.deposito_ref into v_dep_da_baixa
      from public.baixas_estoque b
      where b.pedido_id = new.id and b.tipo = 'baixa' and b.situacao = 'enviada';

      if found then
        insert into public.baixas_estoque (pedido_id, tipo, deposito_ref)
        values (new.id, 'estorno', v_dep_da_baixa)
        on conflict (pedido_id, tipo) do nothing;
      end if;
    end;
  end if;

  return new;
end;
$$;

comment on function public.enfileirar_baixa_do_pedido is
  'Baixa quando a venda chega, so se a CONTA e o geral estiverem ligados. '
  'Estorno quando a venda e cancelada, sem travas, porque peca que saiu tem '
  'que voltar.';

-- Desligar uma conta para de mandar na hora, inclusive o que já estava na
-- fila dela. Sem isto, desligar deixaria vinte baixas saindo depois, e quem
-- desliga espera que pare.
do $$
declare
  v_def text;
  v_novo text;
  v_ancora text;
begin
  v_def := pg_get_functiondef('public.drenar_baixas(integer)'::regprocedure);

  v_ancora := '    where b.situacao = ''pendente''
      and b.tentar_apos <= now()';

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'ancora da fila pendente nao bate';
  end if;

  v_novo := replace(v_def, v_ancora, v_ancora || '
      -- Estorno sempre sai: peca que saiu da prateleira tem que voltar.
      -- Baixa so sai se a conta continuar ligada.
      and (b.tipo = ''estorno'' or exists (
        select 1 from public.pedidos p
        join public.contas ct on ct.id = p.conta_id
        where p.id = b.pedido_id and ct.baixa_estoque_automatica
      ))');

  execute v_novo;
end $$;

-- O geral volta ligado: todas as contas nascem desligadas, nada dispara.
update public.erp_config set ativo = true where id;
