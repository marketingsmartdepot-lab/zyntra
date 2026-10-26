-- APLICADA E DESFEITA no mesmo minuto, pela migracao 20261026190700. Fica
-- registrada porque o banco a registrou, e porque a decisao de NAO fazer isto
-- vale ser achada por quem pensar nisso de novo.
--
-- A ideia: mover a caixa de volta para Conferir, conferir de novo, e a
-- etiqueta nao sai — ja existe uma etiqueta daquele pacote, a segunda e
-- reimpressao, e reimpressao exige motivo escrito, mas o bipe que fecha a
-- caixa nao manda motivo nenhum. Esta migracao fazia a reimpressao HERDAR o
-- motivo da alteracao manual, quando essa alteracao fosse mais nova que a
-- ultima etiqueta.
--
-- A Daniele preferiu manter a trava inteira: "do jeito que esta, esta seguro
-- — eu queria alterar so pra teste mas nao compensa". Duas etiquetas iguais
-- circulando e o erro mais caro do galpao, e afrouxar a trava permanente para
-- facilitar um teste de um dia e troca ruim.

create or replace function privado.enfileirar_impressao(
  p_tipo public.documento_tipo,
  p_conteudo text,
  p_pacote_id uuid,
  p_lista_id uuid,
  p_estacao_id uuid,
  p_operador_id uuid,
  p_copias integer,
  p_motivo_reimpressao text
)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_impressora uuid;
  v_ja integer;
  v_reimpressao boolean := false;
  v_motivo text := nullif(btrim(coalesce(p_motivo_reimpressao, '')), '');
  v_ultima timestamptz;
begin
  if coalesce(trim(p_conteudo), '') = '' then
    return query select false, 'sem_conteudo', null::uuid; return;
  end if;

  if p_tipo in ('etiqueta', 'danfe') and p_pacote_id is null then
    return query select false, 'pacote_nao_informado', null::uuid; return;
  end if;

  if p_tipo = 'lista_separacao' and p_lista_id is null then
    return query select false, 'lista_nao_informada', null::uuid; return;
  end if;

  if p_tipo in ('etiqueta', 'danfe') then
    if not exists (
      select 1 from public.conferencias c
      where c.pacote_id = p_pacote_id and c.situacao = 'concluida'
    ) then
      return query select false, 'conferencia_nao_concluida', null::uuid; return;
    end if;

    select count(*), max(im.enviada_em) into v_ja, v_ultima
    from public.impressoes im
    where im.pacote_id = p_pacote_id and im.tipo = p_tipo;

    v_reimpressao := v_ja > 0;

    if v_reimpressao and v_motivo is null then
      select 'A caixa voltou para a esteira. ' || ev.detalhe
        into v_motivo
      from public.eventos_pacote ev
      where ev.pacote_id = p_pacote_id
        and ev.tipo = 'alteracao_manual'
        and ev.em > v_ultima
      order by ev.em desc
      limit 1;
    end if;

    if v_reimpressao and v_motivo is null then
      return query select false, 'motivo_reimpressao_obrigatorio', null::uuid; return;
    end if;
  end if;

  if p_tipo = 'etiqueta' and exists (
    select 1
    from public.pacotes pa
    join public.envios e      on e.id = pa.envio_id
    join public.modalidades m  on m.id = e.modalidade_id
    where pa.id = p_pacote_id
      and not m.gera_etiqueta
  ) then
    return query select false, 'modalidade_sem_etiqueta', null::uuid; return;
  end if;

  if p_estacao_id is null then
    return query select false, 'estacao_nao_informada', null::uuid; return;
  end if;

  v_impressora := public.impressora_da_estacao(p_estacao_id);

  if v_impressora is null then
    return query select false, 'estacao_sem_impressora', null::uuid; return;
  end if;

  if not exists (
    select 1 from public.impressoras_situacao s
    where s.id = v_impressora and s.agente_online
  ) then
    return query select false, 'agente_offline', null::uuid; return;
  end if;

  insert into public.impressoes
    (tipo, conteudo, copias, pacote_id, lista_id, impressora_id, operador_id,
     reimpressao, motivo_reimpressao)
  values
    (p_tipo, p_conteudo, greatest(coalesce(p_copias, 1), 1), p_pacote_id,
     p_lista_id, v_impressora, p_operador_id, v_reimpressao, v_motivo)
  returning id into v_id;

  return query select true, 'ok', v_id;
end;
$function$;
