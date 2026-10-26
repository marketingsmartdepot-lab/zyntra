-- A alteracao manual age sobre o que esta MARCADO na lista, como as outras
-- acoes em massa da Expedicao — nao uma caixa por vez.
--
-- Devolve o que entrou e o que foi recusado, com o codigo do pedido em cada
-- recusa, igual a `entregar_selecionados_na_doca`. Numero solto ("2 de 5")
-- faz quem marcou cinco caixas ficar procurando quais tres ficaram.
--
-- Recusa NAO derruba o lote: marcar 20 e ver tudo voltar porque uma ja estava
-- na etapa de destino seria pior que mover 19 e dizer qual sobrou.

create or replace function public.alterar_etapa_de_varios(
  p_pacote_ids uuid[],
  p_etapa text,
  p_motivo text
)
returns table (ok boolean, motivo text, mudaram integer, recusados jsonb)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_r record;
  v_codigo text;
  v_n integer := 0;
  v_recusados jsonb := '[]'::jsonb;
  v_frase text;
begin
  if not public.pode('alterar_etapa') then
    return query select false, 'sem_permissao', 0, null::jsonb; return;
  end if;

  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    return query select false, 'motivo_curto', 0, null::jsonb; return;
  end if;

  if p_pacote_ids is null or array_length(p_pacote_ids, 1) is null then
    return query select false, 'nada_selecionado', 0, '[]'::jsonb; return;
  end if;

  foreach v_id in array p_pacote_ids loop
    select * into v_r
    from public.alterar_etapa_manualmente(v_id, p_etapa, p_motivo);

    if v_r.ok then
      v_n := v_n + 1;
      continue;
    end if;

    -- Uma etapa invalida ou falta de permissao nao e caso a caso: para o lote
    -- inteiro, porque vai se repetir em todas as linhas.
    if v_r.motivo in ('etapa_desconhecida', 'sem_permissao') then
      return query select false, v_r.motivo, v_n, v_recusados; return;
    end if;

    select coalesce(pe.ref_externa, e.ref_externa, v_id::text)
      into v_codigo
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    left join public.pedidos pe on pe.envio_id = e.id
    where pa.id = v_id
    limit 1;

    v_frase := case v_r.motivo
      when 'ja_esta_nessa_etapa'   then 'ja estava nessa etapa'
      when 'pacote_nao_encontrado' then 'pacote nao encontrado'
      else v_r.motivo
    end;

    v_recusados := v_recusados || jsonb_build_object(
      'codigo', coalesce(v_codigo, 'sem codigo'), 'motivo', v_frase);
  end loop;

  return query select true, 'ok', v_n, v_recusados;
end;
$function$;

comment on function public.alterar_etapa_de_varios is
  'Altera a etapa dos pacotes marcados na lista. Exige a permissao '
  'alterar_etapa e motivo; recusa individual nao derruba o lote.';

revoke all on function public.alterar_etapa_de_varios(uuid[], text, text)
  from public, anon;
grant execute on function public.alterar_etapa_de_varios(uuid[], text, text)
  to authenticated;
