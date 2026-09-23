-- A baixa guarda em QUAL deposito ela aconteceu.
--
-- O deposito pode mudar: hoje Smart Depot, amanha outro. Se a fila nao
-- guardasse o deposito, um estorno feito depois da troca devolveria a peca no
-- deposito novo — somando estoque onde nunca saiu e deixando faltando onde
-- saiu. Erro silencioso, descoberto no inventario.
--
-- O estorno usa o deposito da baixa que ele desfaz, nao o configurado agora.

alter table public.baixas_estoque
  add column if not exists deposito_ref text;

comment on column public.baixas_estoque.deposito_ref is
  'O deposito vigente quando a baixa foi enfileirada. O estorno usa o mesmo, nao o atual.';

create or replace function public.enfileirar_baixa_da_nota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deposito text;
  v_deposito_da_baixa text;
begin
  if new.pedido_id is null then
    return new;
  end if;

  if new.situacao = 'autorizada' and old.situacao is distinct from 'autorizada' then
    select c.deposito_ref into v_deposito from public.erp_config c where c.id;

    -- `on conflict do nothing` e a segunda camada da trava: mesmo que o
    -- gatilho dispare duas vezes, a linha e uma so.
    insert into public.baixas_estoque (pedido_id, tipo, deposito_ref)
    values (new.pedido_id, 'baixa', v_deposito)
    on conflict (pedido_id, tipo) do nothing;
  end if;

  -- Estorno so faz sentido se a baixa chegou a sair. Nota cancelada cuja
  -- baixa nunca foi enviada nao tem o que devolver.
  if new.situacao = 'cancelada' and old.situacao is distinct from 'cancelada' then
    select b.deposito_ref into v_deposito_da_baixa
    from public.baixas_estoque b
    where b.pedido_id = new.pedido_id
      and b.tipo = 'baixa'
      and b.situacao = 'enviada';

    if found then
      insert into public.baixas_estoque (pedido_id, tipo, deposito_ref)
      values (new.pedido_id, 'estorno', v_deposito_da_baixa)
      on conflict (pedido_id, tipo) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists nota_enfileira_baixa on public.notas_fiscais;

create trigger nota_enfileira_baixa
  after update of situacao on public.notas_fiscais
  for each row execute function public.enfileirar_baixa_da_nota();

comment on function public.enfileirar_baixa_da_nota is
  'Nota autorizada enfileira baixa no deposito vigente; nota cancelada enfileira estorno no deposito onde a baixa saiu.';

revoke execute on function public.enfileirar_baixa_da_nota() from public, anon, authenticated;
