-- Poe o pacote na doca, e a ordem das recusas importa.
--
-- "Ja saiu do galpao" tem que vir ANTES de "ja esta na doca": um pacote que
-- saiu continua registrado na doca, porque aquilo e historico da entrega. Com
-- a ordem invertida, bipar uma caixa que ja foi embora respondia "ja esta na
-- doca" — verdade formal e mentira util, porque manda o operador procurar a
-- caixa na doca, onde ela nao esta.
--
-- "Ja saiu do galpao" e o aviso que importa: ou alguem trouxe de volta um
-- pacote despachado, ou existe uma segunda etiqueta igual circulando.

create or replace function public.bipar_entrega_doca(
  p_entrega_id uuid,
  p_codigo text
)
returns table (ok boolean, motivo text, pacote_id uuid, codigo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_pacote uuid;
  v_etapa text;
  v_gera_etiqueta boolean;
  v_outra text;
begin
  if v_codigo = '' then
    return query select false, 'codigo_vazio', null::uuid, null::text;
    return;
  end if;

  if not exists (select 1 from public.entregas_doca ed where ed.id = p_entrega_id) then
    return query select false, 'entrega_nao_encontrada', null::uuid, v_codigo;
    return;
  end if;

  v_pacote := public.pacote_por_codigo(v_codigo);

  if v_pacote is null then
    return query select false, 'codigo_desconhecido', null::uuid, v_codigo;
    return;
  end if;

  -- Ja esta nesta entrega: o operador se perdeu na pilha. Nao e erro.
  if exists (
    select 1 from public.entregas_doca_pacotes ep
    where ep.entrega_id = p_entrega_id and ep.pacote_id = v_pacote
  ) then
    return query select true, 'ja_bipado', v_pacote, v_codigo;
    return;
  end if;

  -- Antes de olhar a doca: esta caixa ja foi embora?
  if exists (select 1 from public.saida_pacotes sp where sp.pacote_id = v_pacote) then
    return query select false, 'ja_saiu_do_galpao', v_pacote, v_codigo;
    return;
  end if;

  select ed.codigo into v_outra
  from public.entregas_doca_pacotes ep
  join public.entregas_doca ed on ed.id = ep.entrega_id
  where ep.pacote_id = v_pacote
  limit 1;

  if found then
    return query select false, 'ja_na_doca_em_' || v_outra, v_pacote, v_codigo;
    return;
  end if;

  select pa.etapa::text, coalesce(m.gera_etiqueta, false)
    into v_etapa, v_gera_etiqueta
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  left join public.modalidades m on m.id = e.modalidade_id
  where pa.id = v_pacote;

  if v_etapa <> 'pronto' then
    return query select false, 'pacote_nao_esta_pronto', v_pacote, v_codigo;
    return;
  end if;

  -- Aqui a confirmacao de impressao ganha dente: caixa que precisa de
  -- etiqueta e nao teve a etiqueta bipada na mao nao vai para a doca. Sem
  -- isto, "confirmar impressao" seria so um registro bonito e a caixa sairia
  -- sem etiqueta do mesmo jeito.
  if v_gera_etiqueta and not exists (
    select 1 from public.impressoes im
    where im.pacote_id = v_pacote
      and im.tipo = 'etiqueta'
      and im.confirmada_em is not null
  ) then
    return query select false, 'etiqueta_nao_confirmada', v_pacote, v_codigo;
    return;
  end if;

  insert into public.entregas_doca_pacotes (entrega_id, pacote_id)
  values (p_entrega_id, v_pacote);

  return query select true, 'ok', v_pacote, v_codigo;
end;
$$;

comment on function public.bipar_entrega_doca is
  'Poe o pacote na doca. Recusa caixa sem etiqueta confirmada na mao, e avisa antes de tudo quando a caixa ja saiu do galpao.';

revoke all on function public.bipar_entrega_doca(uuid, text) from public;
grant execute on function public.bipar_entrega_doca(uuid, text) to authenticated;
