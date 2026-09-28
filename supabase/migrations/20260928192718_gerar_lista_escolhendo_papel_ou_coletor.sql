drop function if exists public.criar_lista(uuid[]);

create function public.criar_lista(p_pacote_ids uuid[], p_modo text default 'papel')
returns table(ok boolean, motivo text, lista uuid, adicionados integer, recusados integer)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_lista uuid;
  v_add integer;
  v_pedidos integer := coalesce(array_length(p_pacote_ids, 1), 0);
  v_modo text := lower(btrim(coalesce(p_modo, 'papel')));
begin
  perform public.exige_perfil_ativo();
  if not public.pode('gerar_lista') then
    return query select false, 'sem_permissao', null::uuid, 0, 0; return;
  end if;

  if v_modo not in ('papel', 'coletor') then
    return query select false, 'modo_invalido', null::uuid, 0, 0; return;
  end if;

  if v_pedidos = 0 then
    return query select false, 'nenhum_pacote', null::uuid, 0, 0;
    return;
  end if;

  perform 1 from public.pacotes where id = any(p_pacote_ids) for update;

  if exists (
    select 1 from unnest(p_pacote_ids) as x(id)
    left join public.pacotes pa on pa.id = x.id
    where pa.id is null or pa.etapa <> 'separar'
  ) then
    return query select false, 'pacote_fora_de_separar', null::uuid, 0, 0;
    return;
  end if;

  insert into public.listas_separacao (criada_por, separador_id, situacao, modo)
  values (auth.uid(), auth.uid(),
          case when v_modo = 'coletor' then 'em_separacao' else 'emitida' end,
          v_modo)
  returning id into v_lista;

  insert into public.listas_pacotes (lista_id, pacote_id)
  select v_lista, x.id from unnest(p_pacote_ids) as x(id)
  on conflict (pacote_id) where ativa do nothing;

  get diagnostics v_add = row_count;

  if v_add = 0 then
    delete from public.listas_separacao where id = v_lista;
    return query select false, 'todos_ja_em_lista', null::uuid, 0, v_pedidos;
    return;
  end if;

  if v_modo = 'papel' then
    -- Como sempre foi: a folha sai e os pedidos já estão em Conferir.
    update public.pacotes pa
       set etapa = 'conferir'
     where pa.id in (
       select lp.pacote_id from public.listas_pacotes lp where lp.lista_id = v_lista
     );

    update public.listas_pacotes set ativa = false where lista_id = v_lista;
  else
    -- Coletor: os pacotes ficam em Separar, travados nesta lista, até alguém
    -- fechar a separação no aparelho. Sem isso, dois coletores poderiam
    -- receber a mesma caixa.
    insert into public.separacao_itens (lista_id, sku_id, quantidade)
    select v_lista, li.sku_id, 0
    from public.listas_itens li
    where li.lista_id = v_lista
    on conflict do nothing;
  end if;

  return query select true, 'ok', v_lista, v_add, v_pedidos - v_add;
end;
$fn$;

revoke all on function public.criar_lista(uuid[], text) from public;
grant execute on function public.criar_lista(uuid[], text) to authenticated;
