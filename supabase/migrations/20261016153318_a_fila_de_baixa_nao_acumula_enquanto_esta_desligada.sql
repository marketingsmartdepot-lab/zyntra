-- Com o gatilho na hora da venda e o envio desligado, a fila acumularia: cada
-- venda nova enfileira uma baixa que não sai. No dia do corte, ligar faria
-- tudo isso disparar de uma vez — baixando no Bling os pedidos que a Lexos já
-- baixou. Baixa dupla, com dias de acúmulo.
--
-- O corte tem que começar no instante em que ela liga. Então o gatilho só
-- enfileira quando o envio está LIGADO: venda que chegou antes não entra, e a
-- primeira venda depois de ligar é a primeira a baixar.
--
-- O estorno não leva essa trava: se uma baixa foi enviada e o pedido cancela
-- depois de alguém desligar o envio, a peça tem que voltar de qualquer jeito.
-- Ela já saiu da prateleira do Bling — deixar de estornar seria perder a peça.

create or replace function public.enfileirar_baixa_do_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg record;
begin
  select c.ativo, c.deposito_ref into v_cfg from public.erp_config c where c.id;

  -- A venda chegou.
  if tg_op = 'INSERT' then
    if coalesce(new.situacao_canal, '') = 'cancelled' then
      return new;
    end if;

    -- Desligado nao acumula. Ver o comentario da migracao: fila guardada e
    -- baixa dupla esperando a hora.
    if not coalesce(v_cfg.ativo, false) then
      return new;
    end if;

    insert into public.baixas_estoque (pedido_id, tipo, deposito_ref)
    values (new.id, 'baixa', v_cfg.deposito_ref)
    on conflict (pedido_id, tipo) do nothing;

    return new;
  end if;

  -- A venda foi cancelada. Só devolve o que REALMENTE saiu: se a baixa não
  -- chegou a ser enviada, não há nada para estornar, e mandar um estorno
  -- sozinho criaria estoque que nunca existiu.
  --
  -- Sem a trava do `ativo` aqui, de propósito: peça que já saiu da prateleira
  -- do Bling tem que voltar mesmo que o envio tenha sido desligado no meio.
  if coalesce(new.situacao_canal, '') = 'cancelled'
     and coalesce(old.situacao_canal, '') is distinct from 'cancelled' then

    declare
      v_deposito text;
    begin
      select b.deposito_ref into v_deposito
      from public.baixas_estoque b
      where b.pedido_id = new.id and b.tipo = 'baixa' and b.situacao = 'enviada';

      if found then
        insert into public.baixas_estoque (pedido_id, tipo, deposito_ref)
        values (new.id, 'estorno', v_deposito)
        on conflict (pedido_id, tipo) do nothing;
      end if;
    end;
  end if;

  return new;
end;
$$;

comment on function public.enfileirar_baixa_do_pedido is
  'Baixa quando a venda chega, SO se o envio ao Bling estiver ligado (fila '
  'guardada e baixa dupla esperando a hora). Estorno quando a venda e '
  'cancelada, sem essa trava, porque peca que saiu tem que voltar.';
