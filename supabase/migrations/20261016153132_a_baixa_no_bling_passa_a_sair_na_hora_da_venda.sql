-- A baixa de estoque no Bling muda de momento, por decisão dela.
--
-- COMO ERA: o gatilho esperava a nota virar `autorizada`. Nunca disparou, e
-- não por acerto: nota da Lexos NASCE autorizada, num insert, e insert não
-- dispara gatilho de update. Ficou certo por acidente.
--
-- COMO FICA: a baixa sai quando a venda chega. É o que a Lexos faz hoje, e o
-- motivo é concreto — a Lexos continua refletindo o saldo do Bling no anúncio.
-- Se o Bling só baixasse na emissão da nota, existiria um intervalo com a peça
-- vendida e o anúncio ainda publicando ela como disponível. Com nota travada,
-- esse intervalo não acabaria nunca.
--
-- O ESTORNO vai junto, e isto ela não pediu: hoje ele dispara em nota
-- cancelada. Com a baixa na venda, pedido cancelado ANTES de sair nota baixaria
-- e nunca devolveria — peça sumindo do estoque sem ninguém ver. Deixar
-- assimétrico seria construir um buraco conhecido.
--
-- E o cancelamento mora em `situacao_canal`, não em `cancelado_em`: essa coluna
-- existe e NUNCA é gravada por ninguém.

drop trigger if exists nota_enfileira_baixa on public.notas_fiscais;
drop function if exists public.enfileirar_baixa_da_nota();

/**
 * Enfileira a baixa quando a venda chega, e o estorno quando ela é cancelada.
 *
 * Só enfileira — não fala com o Bling. Os itens são montados depois, por
 * `drenar_baixas`, e isso é de propósito: no instante deste gatilho os itens
 * do pedido ainda não foram gravados (a varredura grava o pedido primeiro e os
 * itens em seguida).
 */
create or replace function public.enfileirar_baixa_do_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deposito text;
begin
  -- A venda chegou.
  if tg_op = 'INSERT' then
    if coalesce(new.situacao_canal, '') = 'cancelled' then
      return new;
    end if;

    select c.deposito_ref into v_deposito from public.erp_config c where c.id;

    insert into public.baixas_estoque (pedido_id, tipo, deposito_ref)
    values (new.id, 'baixa', v_deposito)
    on conflict (pedido_id, tipo) do nothing;

    return new;
  end if;

  -- A venda foi cancelada. Só devolve o que REALMENTE saiu: se a baixa não
  -- chegou a ser enviada, não há nada para estornar, e mandar um estorno
  -- sozinho criaria estoque que nunca existiu.
  if coalesce(new.situacao_canal, '') = 'cancelled'
     and coalesce(old.situacao_canal, '') is distinct from 'cancelled' then

    select b.deposito_ref into v_deposito
    from public.baixas_estoque b
    where b.pedido_id = new.id and b.tipo = 'baixa' and b.situacao = 'enviada';

    if found then
      insert into public.baixas_estoque (pedido_id, tipo, deposito_ref)
      values (new.id, 'estorno', v_deposito)
      on conflict (pedido_id, tipo) do nothing;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enfileirar_baixa_do_pedido is
  'Baixa quando a venda chega; estorno quando ela e cancelada, e somente se a '
  'baixa tinha sido enviada.';

create trigger pedido_enfileira_baixa
  after insert on public.pedidos
  for each row execute function public.enfileirar_baixa_do_pedido();

create trigger pedido_cancelado_estorna
  after update of situacao_canal on public.pedidos
  for each row execute function public.enfileirar_baixa_do_pedido();

-- ---------------------------------------------------------------------------
-- Desligado. Ela liga em Integração › Estoque quando a Lexos soltar os
-- pedidos. Sem isto, a mudança de gatilho faria a próxima venda baixar no
-- Bling de produção em até dois minutos.
update public.erp_config set ativo = false where id;
