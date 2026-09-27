/**
 * Põe as caixas selecionadas dentro de um carrinho, sem bipar.
 *
 * Marcar na tela de Pronto pra envio e registrar já coloca as caixas na doca.
 * O bipe da doca continua existindo para quem preferir, mas deixa de ser
 * obrigatório.
 *
 * As REGRAS são as mesmas do bipe, uma por uma — não um atalho mais frouxo.
 * Caixa que não está pronta, que precisa de etiqueta e não teve a impressão
 * confirmada, que já está noutro carrinho ou que já saiu do galpão continua
 * recusada. A diferença é só por onde a caixa foi apontada.
 *
 * Devolve quantas entraram e QUAIS foram recusadas, com o motivo. Um número
 * sozinho faria a pessoa empurrar o carrinho achando que levou tudo.
 */
create or replace function public.entregar_selecionados_na_doca(
  p_entrega_id uuid,
  p_pacote_ids uuid[]
) returns table(ok boolean, motivo text, entraram integer, recusados jsonb)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_id uuid;
  v_etapa text;
  v_gera_etiqueta boolean;
  v_outra text;
  v_codigo text;
  v_n integer := 0;
  v_recusados jsonb := '[]'::jsonb;
  v_motivo text;
begin
  perform public.exige_perfil_ativo();

  if not exists (select 1 from public.entregas_doca ed where ed.id = p_entrega_id) then
    return query select false, 'entrega_nao_encontrada', 0, null::jsonb;
    return;
  end if;

  if p_pacote_ids is null or array_length(p_pacote_ids, 1) is null then
    return query select true, 'nada_selecionado', 0, '[]'::jsonb;
    return;
  end if;

  foreach v_id in array p_pacote_ids loop
    v_motivo := null;

    select coalesce(pe.ref_externa, e.ref_externa)
      into v_codigo
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    left join public.pedidos pe on pe.envio_id = e.id
    where pa.id = v_id
    limit 1;

    -- Já está neste carrinho: não é erro, é a pessoa marcando duas vezes.
    if exists (
      select 1 from public.entregas_doca_pacotes ep
      where ep.entrega_id = p_entrega_id and ep.pacote_id = v_id
    ) then
      v_n := v_n + 1;
      continue;
    end if;

    if exists (select 1 from public.saida_pacotes sp where sp.pacote_id = v_id) then
      v_motivo := 'ja saiu do galpao';
    else
      select ed.codigo into v_outra
      from public.entregas_doca_pacotes ep
      join public.entregas_doca ed on ed.id = ep.entrega_id
      where ep.pacote_id = v_id
      limit 1;

      if v_outra is not null then
        v_motivo := 'ja esta no carrinho ' || v_outra;
      end if;
    end if;

    if v_motivo is null then
      select pa.etapa::text, coalesce(m.gera_etiqueta, false)
        into v_etapa, v_gera_etiqueta
      from public.pacotes pa
      join public.envios e on e.id = pa.envio_id
      left join public.modalidades m on m.id = e.modalidade_id
      where pa.id = v_id;

      if v_etapa is null then
        v_motivo := 'pacote nao encontrado';
      elsif v_etapa <> 'pronto' then
        v_motivo := 'nao esta pronto pra envio';
      elsif v_gera_etiqueta and not exists (
        select 1 from public.impressoes im
        where im.pacote_id = v_id
          and im.tipo = 'etiqueta'
          and im.confirmada_em is not null
      ) then
        v_motivo := 'etiqueta ainda nao foi confirmada';
      end if;
    end if;

    if v_motivo is not null then
      v_recusados := v_recusados || jsonb_build_object(
        'codigo', coalesce(v_codigo, 'sem codigo'), 'motivo', v_motivo);
      continue;
    end if;

    insert into public.entregas_doca_pacotes (entrega_id, pacote_id)
    values (p_entrega_id, v_id);

    v_n := v_n + 1;
  end loop;

  return query select true, 'ok', v_n, v_recusados;
end;
$fn$;

revoke all on function public.entregar_selecionados_na_doca(uuid, uuid[]) from public;
grant execute on function public.entregar_selecionados_na_doca(uuid, uuid[]) to authenticated;
