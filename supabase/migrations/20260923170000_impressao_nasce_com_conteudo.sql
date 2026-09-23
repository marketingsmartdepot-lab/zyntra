-- Trabalho de impressao nasce com o papel dentro.
--
-- Antes, solicitar_impressao criava a linha sem `conteudo`. E o agente so pega
-- trabalho com conteudo — entao o pedido de impressao entrava na fila e ficava
-- la para sempre, sem ninguem imprimir e sem erro nenhum aparecer. Fila com
-- trabalho invisivel e pior do que fila vazia: a tela diz que mandou.
--
-- Agora o conteudo e obrigatorio. Quem monta o ZPL e o servidor, que e onde
-- da para formatar e, no caso da etiqueta, buscar no Mercado Livre antes.

drop function if exists public.solicitar_impressao(
  public.documento_tipo, uuid, uuid, uuid, uuid, text
);

create function public.solicitar_impressao(
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
  -- Sem papel nao ha trabalho. Recusar aqui e melhor do que enfileirar nada.
  if coalesce(trim(p_conteudo), '') = '' then
    return query select false, 'sem_conteudo', null::uuid;
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

comment on function public.solicitar_impressao is
  'Enfileira um documento ja montado. Recusa sem conteudo: trabalho sem papel fica invisivel para o agente e a tela mentiria dizendo que mandou.';

revoke all on function public.solicitar_impressao(
  public.documento_tipo, text, uuid, uuid, uuid, uuid, integer, text
) from public;
grant execute on function public.solicitar_impressao(
  public.documento_tipo, text, uuid, uuid, uuid, uuid, integer, text
) to authenticated;

-- Ninguem chama: o ponto e batido dentro de agente_reservar_trabalhos. Era uma
-- funcao security definer exposta SEM login, recebendo token — ou seja, um
-- oraculo de graça para descobrir se um token e valido.
drop function if exists public.agente_bater_ponto(text, text);
