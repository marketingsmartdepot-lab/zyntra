-- A etiqueta vai parar de passar pela Edge Function no caminho comum: o ZPL
-- ja esta guardado aqui, e o site vai enfileirar direto. Sao ~2 dos 4
-- segundos entre o bipe e a etiqueta.
--
-- Mas a Edge Function fazia uma guarda que o site nao faz: recusar etiqueta de
-- modalidade que nao gera etiqueta — envio combinado com o comprador, por
-- exemplo. Tirar ela do caminho sem trazer a guarda abriria o furo de imprimir
-- etiqueta de envio que nao tem etiqueta.
--
-- Guarda vale mais no miolo que em cada porta. Aqui ela vale para quem chama
-- pelo site, pela Edge Function e por qualquer coisa que venha depois.

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
begin
  if coalesce(trim(p_conteudo), '') = '' then
    return query select false, 'sem_conteudo', null::uuid; return;
  end if;

  -- O documento precisa saber de quem ele e.
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

    select count(*) into v_ja
    from public.impressoes im
    where im.pacote_id = p_pacote_id and im.tipo = p_tipo;

    v_reimpressao := v_ja > 0;

    if v_reimpressao and coalesce(trim(p_motivo_reimpressao), '') = '' then
      return query select false, 'motivo_reimpressao_obrigatorio', null::uuid; return;
    end if;
  end if;

  -- Modalidade que nao gera etiqueta nao tem etiqueta para imprimir. Vinha da
  -- Edge Function; desceu para ca quando o site passou a enfileirar direto.
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
     p_lista_id, v_impressora, p_operador_id, v_reimpressao,
     nullif(trim(coalesce(p_motivo_reimpressao, '')), ''))
  returning id into v_id;

  return query select true, 'ok', v_id;
end;
$function$;

comment on function privado.enfileirar_impressao is
  'O miolo de enfileirar impressao, sem checar identidade. Guarda aqui tudo o '
  'que vale para qualquer chamador: conferencia fechada, modalidade que gera '
  'etiqueta, bancada com impressora e agente online.';
