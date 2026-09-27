-- `impressoes.operador_id` agora aponta para perfis. Passar um id de operador
-- de PIN quebraria a chave estrangeira na primeira confirmação. E quem bipa a
-- etiqueta na bancada é a mesma pessoa que está conferindo: o login.
drop function if exists public.confirmar_impressao_por_codigo(uuid, text, uuid);

create function public.confirmar_impressao_por_codigo(
  p_pacote_id uuid,
  p_codigo text
) returns table(ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_do_codigo uuid;
  v_impressao uuid;
  v_outro text;
begin
  perform public.exige_perfil_ativo();
  if v_codigo = '' then
    return query select false, 'codigo_vazio', null::uuid;
    return;
  end if;

  v_do_codigo := public.pacote_por_codigo(v_codigo);

  if v_do_codigo is null then
    return query select false, 'codigo_desconhecido', null::uuid;
    return;
  end if;

  -- Bipou a etiqueta de outra caixa. Dizer de qual, senão o operador fica
  -- procurando defeito no leitor.
  if v_do_codigo <> p_pacote_id then
    select p.ref_externa into v_outro
    from public.pedidos p
    join public.pacotes pa on pa.envio_id = p.envio_id
    where pa.id = v_do_codigo
    order by p.criado_em
    limit 1;

    return query select false,
      'etiqueta_de_outro_pacote:' || coalesce(v_outro, 'sem referencia'),
      null::uuid;
    return;
  end if;

  -- Só confirma o que a impressora aceitou. Trabalho em erro ou na fila não
  -- virou papel.
  select im.id into v_impressao
  from public.impressoes im
  where im.pacote_id = p_pacote_id
    and im.tipo = 'etiqueta'
    and im.situacao = 'impressa'
    and im.confirmada_em is null
  order by im.enviada_em desc
  limit 1;

  if v_impressao is null then
    if exists (
      select 1 from public.impressoes im
      where im.pacote_id = p_pacote_id and im.tipo = 'etiqueta'
        and im.situacao in ('pendente', 'entregue_ao_agente')
    ) then
      return query select false, 'ainda_na_fila', null::uuid;
      return;
    end if;

    if exists (
      select 1 from public.impressoes im
      where im.pacote_id = p_pacote_id and im.tipo = 'etiqueta'
        and im.confirmada_em is not null
    ) then
      return query select false, 'ja_confirmada', null::uuid;
      return;
    end if;

    return query select false, 'nada_foi_impresso', null::uuid;
    return;
  end if;

  update public.impressoes im
     set confirmada_em = now(),
         confirmada_codigo = v_codigo,
         operador_id = coalesce(auth.uid(), im.operador_id)
   where im.id = v_impressao;

  return query select true, 'ok', v_impressao;
end;
$fn$;

revoke all on function public.confirmar_impressao_por_codigo(uuid, text) from public;
grant execute on function public.confirmar_impressao_por_codigo(uuid, text) to authenticated;
