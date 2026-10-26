-- Mover a caixa para Conferir na mao e, na cabeca de quem faz, "quero conferir
-- de novo". Mas a conferencia antiga esta `concluida` e mover a etapa nao a
-- reabre — entao a aba Conferir mostra o botao "Abrir a bancada" em vez do
-- campo de bipe, e quem esperava bipar acha que nao funcionou. Foi o que
-- aconteceu com a Daniele hoje.
--
-- Quem reabre e o site, logo depois da alteracao, porque e la que se sabe de
-- qual BANCADA a maquina e (mora num cookie). Reabrir daqui gravaria a
-- conferencia sem bancada, e aquela coluna e justamente a que responde "onde
-- essa caixa foi conferida".
--
-- Para o site reabrir, ele precisa saber EM QUAIS caixas mexer. A contagem
-- nao serve: num lote de 20 com 2 recusadas, reabrir as 20 abriria bancada em
-- caixa que nao mudou de etapa.
--
-- `drop` antes do `create`: acrescentar uma coluna de saida muda o tipo de
-- retorno, e o Postgres nao deixa trocar isso num `create or replace`.

drop function if exists public.alterar_etapa_de_varios(uuid[], text, text);

create function public.alterar_etapa_de_varios(
  p_pacote_ids uuid[],
  p_etapa text,
  p_motivo text
)
returns table (ok boolean, motivo text, mudaram integer, mudados uuid[], recusados jsonb)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_r record;
  v_codigo text;
  v_n integer := 0;
  v_mudados uuid[] := '{}';
  v_recusados jsonb := '[]'::jsonb;
  v_frase text;
begin
  if not public.pode('alterar_etapa') then
    return query select false, 'sem_permissao', 0, null::uuid[], null::jsonb; return;
  end if;

  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    return query select false, 'motivo_curto', 0, null::uuid[], null::jsonb; return;
  end if;

  if p_pacote_ids is null or array_length(p_pacote_ids, 1) is null then
    return query select false, 'nada_selecionado', 0, '{}'::uuid[], '[]'::jsonb; return;
  end if;

  foreach v_id in array p_pacote_ids loop
    select * into v_r
    from public.alterar_etapa_manualmente(v_id, p_etapa, p_motivo);

    if v_r.ok then
      v_n := v_n + 1;
      v_mudados := v_mudados || v_id;
      continue;
    end if;

    -- Uma etapa invalida ou falta de permissao nao e caso a caso: para o lote
    -- inteiro, porque vai se repetir em todas as linhas.
    if v_r.motivo in ('etapa_desconhecida', 'sem_permissao') then
      return query select false, v_r.motivo, v_n, v_mudados, v_recusados; return;
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

  return query select true, 'ok', v_n, v_mudados, v_recusados;
end;
$function$;

comment on function public.alterar_etapa_de_varios is
  'Altera a etapa dos pacotes marcados na lista. Exige a permissao '
  'alterar_etapa e motivo; recusa individual nao derruba o lote. Devolve os '
  'ids que mudaram, para o site reabrir a bancada quando o destino e Conferir.';

revoke all on function public.alterar_etapa_de_varios(uuid[], text, text)
  from public, anon;
grant execute on function public.alterar_etapa_de_varios(uuid[], text, text)
  to authenticated;
