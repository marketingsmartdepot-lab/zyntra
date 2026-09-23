-- Confirmar impressao passa a EXIGIR a etiqueta certa.
--
-- A versao anterior gravava qualquer texto que chegasse: bipar o proprio
-- cracha contava como prova de que a etiqueta saiu. Confirmacao que aceita
-- qualquer coisa nao prova nada, e e pior do que nao existir, porque da uma
-- sensacao de controle que nao corresponde ao papel na caixa.
--
-- Agora o codigo bipado tem que resolver PARA ESTE PACOTE, e so existe o que
-- confirmar se a impressora aceitou o comando (`impressa`). Trabalho com erro
-- ou ainda na fila nao produziu papel nenhum.

-- A mesma resolucao de codigo serve a dois lugares (bipe de saida e esta
-- confirmacao). Estava duplicada dentro de bipar_saida_por_codigo; agora e uma
-- funcao so, e quem mudar a regra muda num lugar.
create or replace function public.pacote_por_codigo(p_codigo text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pa.id
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  where upper(e.ref_externa) = upper(trim(p_codigo))
  union all
  select pa.id
  from public.pacotes pa
  join public.pedidos p on p.envio_id = pa.envio_id
  where upper(p.ref_externa) = upper(trim(p_codigo))
     or upper(p.pack_ref) = upper(trim(p_codigo))
  limit 1;
$$;

comment on function public.pacote_por_codigo is
  'A etiqueta pode carregar a referencia do envio, do pedido ou do pack. Todas resolvem para o mesmo pacote.';

drop function if exists public.confirmar_impressao(uuid, text);

create or replace function public.confirmar_impressao_por_codigo(
  p_pacote_id uuid,
  p_codigo text,
  p_operador_id uuid default null
)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_do_codigo uuid;
  v_impressao uuid;
  v_outro text;
begin
  if v_codigo = '' then
    return query select false, 'codigo_vazio', null::uuid;
    return;
  end if;

  v_do_codigo := public.pacote_por_codigo(v_codigo);

  if v_do_codigo is null then
    return query select false, 'codigo_desconhecido', null::uuid;
    return;
  end if;

  -- Bipou a etiqueta de outra caixa. Dizer de qual, senao o operador fica
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

  -- So confirma o que a impressora aceitou. Trabalho em erro ou na fila nao
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
         operador_id = coalesce(p_operador_id, im.operador_id)
   where im.id = v_impressao;

  return query select true, 'ok', v_impressao;
end;
$$;

comment on function public.confirmar_impressao_por_codigo is
  'A prova fisica de que saiu papel: o operador bipa a etiqueta impressa, e ela tem que ser a deste pacote.';

revoke all on function public.pacote_por_codigo(text) from public;
revoke all on function public.confirmar_impressao_por_codigo(uuid, text, uuid) from public;
grant execute on function public.pacote_por_codigo(text) to authenticated;
grant execute on function public.confirmar_impressao_por_codigo(uuid, text, uuid) to authenticated;

-- bipar_saida_por_codigo passa a usar a funcao comum em vez da copia interna.
create or replace function public.bipar_saida_por_codigo(
  p_saida_id uuid,
  p_codigo text,
  p_operador_id uuid default null
)
returns table (ok boolean, motivo text, custo numeric, pacote_id uuid, codigo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_pacote uuid;
  v_mod_pacote uuid;
  v_mod_saida uuid;
  v_nome_mod text;
  v_r record;
begin
  if v_codigo = '' then
    return query select false, 'codigo_vazio', null::numeric, null::uuid, null::text;
    return;
  end if;

  select s.modalidade_id into v_mod_saida
  from public.saidas s
  where s.id = p_saida_id and s.situacao = 'em_andamento';

  if not found then
    return query select false, 'saida_nao_aberta', null::numeric, null::uuid, null::text;
    return;
  end if;

  v_pacote := public.pacote_por_codigo(v_codigo);

  if v_pacote is null then
    return query select false, 'codigo_desconhecido', null::numeric, null::uuid, v_codigo;
    return;
  end if;

  select e.modalidade_id, m.nome into v_mod_pacote, v_nome_mod
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  left join public.modalidades m on m.id = e.modalidade_id
  where pa.id = v_pacote;

  if v_mod_pacote is distinct from v_mod_saida then
    return query select false,
      'outra_modalidade:' || coalesce(v_nome_mod, 'sem modalidade'),
      null::numeric, v_pacote, v_codigo;
    return;
  end if;

  select * into v_r from public.bipar_saida(p_saida_id, v_pacote, p_operador_id);

  return query select v_r.ok, v_r.motivo, v_r.custo, v_pacote, v_codigo;
end;
$$;
