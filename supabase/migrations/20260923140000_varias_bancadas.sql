-- Várias pessoas conferindo ao mesmo tempo, cada uma na sua bancada.
--
-- Duas coisas precisam ser verdade para isso não virar confusão:
--
--  1. A etiqueta sai NA IMPRESSORA DAQUELA BANCADA, sozinha. Seletor de
--     impressora a cada pedido é exatamente como a etiqueta vai parar na
--     bancada errada.
--  2. Pacote aberto numa bancada não pode aparecer disponível na outra. O
--     índice já impede duas conferências abertas, mas recusar no clique é
--     pior experiência que não oferecer.

create or replace function public.impressora_da_estacao(p_estacao_id uuid)
returns uuid
language sql stable set search_path = ''
as $$
  select i.id from public.impressoras i
  where i.estacao_id = p_estacao_id and i.ativa
  order by i.criada_em limit 1;
$$;

revoke all on function public.impressora_da_estacao(uuid) from public, anon;
grant execute on function public.impressora_da_estacao(uuid) to authenticated;

-- Trocou o parâmetro: recebia a impressora, agora recebe a estação.
drop function if exists public.solicitar_impressao(public.documento_tipo, uuid, uuid, uuid, uuid, text);

create function public.solicitar_impressao(
  p_tipo public.documento_tipo,
  p_pacote_id uuid default null,
  p_lista_id uuid default null,
  p_estacao_id uuid default null,
  p_operador_id uuid default null,
  p_motivo_reimpressao text default null
)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid; v_impressora uuid; v_ja integer; v_reimpressao boolean := false;
begin
  if p_tipo in ('etiqueta', 'danfe') then
    if not exists (select 1 from public.conferencias c
                   where c.pacote_id = p_pacote_id and c.situacao = 'concluida') then
      return query select false, 'conferencia_nao_concluida', null::uuid; return;
    end if;

    select count(*) into v_ja from public.impressoes im
    where im.pacote_id = p_pacote_id and im.tipo = p_tipo;
    v_reimpressao := v_ja > 0;

    if v_reimpressao and coalesce(trim(p_motivo_reimpressao), '') = '' then
      return query select false, 'motivo_reimpressao_obrigatorio', null::uuid; return;
    end if;
  end if;

  if p_estacao_id is null then
    return query select false, 'estacao_nao_informada', null::uuid; return;
  end if;

  v_impressora := public.impressora_da_estacao(p_estacao_id);

  if v_impressora is null then
    return query select false, 'estacao_sem_impressora', null::uuid; return;
  end if;

  if not exists (select 1 from public.impressoras_situacao s
                 where s.id = v_impressora and s.agente_online) then
    return query select false, 'agente_offline', null::uuid; return;
  end if;

  insert into public.impressoes
    (tipo, pacote_id, lista_id, impressora_id, operador_id, reimpressao, motivo_reimpressao)
  values
    (p_tipo, p_pacote_id, p_lista_id, v_impressora, p_operador_id,
     v_reimpressao, nullif(trim(coalesce(p_motivo_reimpressao, '')), ''))
  returning id into v_id;

  return query select true, 'ok', v_id;
end;
$$;

comment on function public.solicitar_impressao is
  'O trabalho vai para a impressora DA BANCADA que pediu. Sem seletor.';

revoke all on function public.solicitar_impressao(public.documento_tipo, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.solicitar_impressao(public.documento_tipo, uuid, uuid, uuid, uuid, text) to authenticated;

create or replace view public.pacotes_em_conferencia
with (security_invoker = true)
as
select c.pacote_id, c.id as conferencia_id, c.iniciada_em,
       e.id as estacao_id, e.nome as estacao, o.nome as operador
from public.conferencias c
left join public.estacoes e on e.id = c.estacao_id
left join public.sessoes_estacao se on se.id = c.sessao_id
left join public.operadores o on o.id = se.operador_id
where c.situacao = 'em_andamento';

comment on view public.pacotes_em_conferencia is
  'Pacote aberto em alguma bancada agora. A fila usa isso para nao oferecer o que ja esta com outra pessoa.';
