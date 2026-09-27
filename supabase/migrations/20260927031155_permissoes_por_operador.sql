-- Duas coisas que ela quer liberar só para algumas pessoas: reiniciar uma
-- conferência e conferir digitando o código do SKU.
--
-- São permissões por OPERADOR, não por papel, porque ela disse "alguns
-- colaboradores" — e papel é grosso demais: nem todo líder precisa reiniciar
-- conferência, e às vezes é justamente um operador antigo que precisa.
--
-- Ambas nascem DESLIGADAS. Reiniciar apaga leitura já feita, e digitar o SKU
-- é prova mais fraca que bipar: quem ligar está assumindo isso de propósito,
-- não herdando por descuido.

alter table public.operadores
  add column if not exists pode_reiniciar_conferencia boolean not null default false,
  add column if not exists pode_bipar_por_sku boolean not null default false;

comment on column public.operadores.pode_reiniciar_conferencia is
  'Pode zerar uma conferência em andamento. Apaga as leituras já feitas.';
comment on column public.operadores.pode_bipar_por_sku is
  'Pode conferir digitando o código do SKU quando o produto não tem código de '
  'barras. Bipar lê o que está na caixa; digitar é alguém afirmando o que está.';

/**
 * Zera uma conferência em andamento.
 *
 * Apaga as leituras e volta as quantidades a zero, mantendo a conferência
 * aberta — quem está na bancada recomeça sem sair da tela.
 *
 * O histórico do pacote NÃO é apagado: fica o registro de que alguém
 * reiniciou, com o nome. Uma caixa que foi reiniciada três vezes numa tarde é
 * um sinal, e sinal apagado não avisa ninguém.
 */
create or replace function public.reiniciar_conferencia(
  p_conferencia_id uuid,
  p_operador_id uuid
) returns table(ok boolean, motivo text, apagadas integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_op record;
  v_pacote uuid;
  v_n integer := 0;
begin
  perform public.exige_perfil_ativo();

  select o.id, o.nome, o.pode_reiniciar_conferencia, o.ativo
    into v_op
  from public.operadores o where o.id = p_operador_id;

  if not found or not v_op.ativo then
    return query select false, 'operador_invalido', 0; return;
  end if;

  if not v_op.pode_reiniciar_conferencia then
    return query select false, 'sem_permissao', 0; return;
  end if;

  select c.pacote_id into v_pacote
  from public.conferencias c
  where c.id = p_conferencia_id and c.situacao = 'em_andamento';

  if v_pacote is null then
    return query select false, 'conferencia_nao_aberta', 0; return;
  end if;

  delete from public.leituras l where l.conferencia_id = p_conferencia_id;
  get diagnostics v_n = row_count;

  update public.conferencia_itens ci
     set quantidade_lida = 0
   where ci.conferencia_id = p_conferencia_id;

  -- Divergência aberta também some: ela descrevia uma contagem que não
  -- existe mais.
  delete from public.divergencias d
   where d.conferencia_id = p_conferencia_id and d.liberada_em is null;

  insert into public.eventos_pacote (pacote_id, tipo, detalhe)
  values (v_pacote, 'conferencia_reiniciada',
          'por ' || v_op.nome || ' · ' || v_n || ' leitura(s) apagada(s)');

  return query select true, 'ok', v_n;
end;
$$;

revoke all on function public.reiniciar_conferencia(uuid, uuid) from public;
grant execute on function public.reiniciar_conferencia(uuid, uuid) to authenticated;
