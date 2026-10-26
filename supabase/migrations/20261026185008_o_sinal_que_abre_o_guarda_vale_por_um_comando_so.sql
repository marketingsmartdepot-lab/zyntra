-- `set_config(..., true)` vale ate o fim da TRANSACAO, nao do comando. Entao
-- `alterar_etapa_manualmente` ligava o sinal, movia a caixa, e deixava o
-- sinal ligado: qualquer outro update em `pacotes` na mesma transacao passava
-- pelo guarda sem ninguem ter pedido.
--
-- Em producao cada chamada do PostgREST e uma transacao propria, entao hoje
-- isso nao causa dano. Mas e sorte da topologia, nao desenho — e uma funcao
-- futura que chamasse esta e depois mexesse na etapa herdaria uma trava
-- desligada sem saber. Uma asserção pegou isto antes de ir para o galpao.
--
-- Agora o sinal e desligado logo depois do update: ele cobre UM comando.

create or replace function public.alterar_etapa_manualmente(
  p_pacote_id uuid,
  p_etapa text,
  p_motivo text
)
returns table (ok boolean, motivo text, de text, para text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_de text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_para public.etapa;
begin
  if not public.pode('alterar_etapa') then
    return query select false, 'sem_permissao', null::text, null::text; return;
  end if;

  -- Motivo curto nao e motivo. "ok", "teste" e "." nao explicam nada a quem
  -- abrir o historico depois, que e a unica razao de pedir motivo.
  if length(v_motivo) < 5 then
    return query select false, 'motivo_curto', null::text, null::text; return;
  end if;

  begin
    v_para := p_etapa::public.etapa;
  exception when others then
    return query select false, 'etapa_desconhecida', null::text, null::text; return;
  end;

  select pa.etapa::text into v_de from public.pacotes pa where pa.id = p_pacote_id;

  if v_de is null then
    return query select false, 'pacote_nao_encontrado', null::text, null::text; return;
  end if;

  if v_de = v_para::text then
    return query select false, 'ja_esta_nessa_etapa', v_de, v_de; return;
  end if;

  -- Liga, move, desliga. O sinal cobre este update e mais nenhum: deixa-lo
  -- ligado abriria a trava para o resto da transacao.
  perform set_config('zyntra.alteracao_manual', '1', true);

  begin
    update public.pacotes set etapa = v_para where id = p_pacote_id;
  exception when others then
    perform set_config('zyntra.alteracao_manual', '0', true);
    raise;
  end;

  perform set_config('zyntra.alteracao_manual', '0', true);

  -- O gatilho ja gravou o evento 'etapa'. Este segundo evento existe para
  -- carregar o MOTIVO e dizer que foi na mao — sem ele, no historico, um
  -- salto manual fica igual a um movimento normal da esteira.
  insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe, por)
  values (p_pacote_id, 'alteracao_manual', v_de, v_para::text,
          'Etapa alterada na mao. Motivo: ' || v_motivo, auth.uid());

  return query select true, 'ok', v_de, v_para::text;
end;
$function$;

comment on function public.alterar_etapa_manualmente is
  'Move a caixa para qualquer etapa, furando o caminho normal da esteira. '
  'Exige a permissao alterar_etapa e um motivo escrito, que fica no historico. '
  'Muda a ETAPA e nada mais: nao grava saida nem cobra custo de etiqueta.';
