-- Recusar dizendo por que, em vez de estourar.
--
-- A tabela ja tem uma trava certa: etiqueta e danfe precisam de pacote, lista
-- de separacao precisa de lista. Mas quem batia nela recebia uma excecao crua
-- do Postgres — 500 na tela, sem motivo que alguem consiga ler. Todas as
-- outras recusas desta funcao devolvem (false, motivo); estas duas nao.

create or replace function public.solicitar_impressao(
  p_tipo public.documento_tipo,
  p_conteudo text,
  p_pacote_id uuid default null,
  p_lista_id uuid default null,
  p_estacao_id uuid default null,
  p_operador_id uuid default null,
  p_copias integer default 1,
  p_motivo_reimpressao text default null
)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_impressora uuid;
  v_ja integer;
  v_reimpressao boolean := false;
begin
  if coalesce(trim(p_conteudo), '') = '' then
    return query select false, 'sem_conteudo', null::uuid;
    return;
  end if;

  -- O documento precisa saber de quem ele e.
  if p_tipo in ('etiqueta', 'danfe') and p_pacote_id is null then
    return query select false, 'pacote_nao_informado', null::uuid;
    return;
  end if;

  if p_tipo = 'lista_separacao' and p_lista_id is null then
    return query select false, 'lista_nao_informada', null::uuid;
    return;
  end if;

  if p_tipo in ('etiqueta', 'danfe') then
    if not exists (
      select 1 from public.conferencias c
      where c.pacote_id = p_pacote_id and c.situacao = 'concluida'
    ) then
      return query select false, 'conferencia_nao_concluida', null::uuid;
      return;
    end if;

    select count(*) into v_ja
    from public.impressoes im
    where im.pacote_id = p_pacote_id and im.tipo = p_tipo;

    v_reimpressao := v_ja > 0;

    if v_reimpressao and coalesce(trim(p_motivo_reimpressao), '') = '' then
      return query select false, 'motivo_reimpressao_obrigatorio', null::uuid;
      return;
    end if;
  end if;

  if p_estacao_id is null then
    return query select false, 'estacao_nao_informada', null::uuid;
    return;
  end if;

  v_impressora := public.impressora_da_estacao(p_estacao_id);

  if v_impressora is null then
    return query select false, 'estacao_sem_impressora', null::uuid;
    return;
  end if;

  if not exists (
    select 1 from public.impressoras_situacao s
    where s.id = v_impressora and s.agente_online
  ) then
    return query select false, 'agente_offline', null::uuid;
    return;
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
$$;
