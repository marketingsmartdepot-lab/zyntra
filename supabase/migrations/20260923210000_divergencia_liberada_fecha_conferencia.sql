-- Divergencia liberada e justamente a autorizacao para fechar com diferenca.
--
-- A ordem das checagens estava errada: `faltam_unidades` era testado antes da
-- divergencia e ja retornava. O lider liberava, e o pacote continuava sem
-- fechar — a liberacao nao servia para nada.
--
-- Agora: divergencia ABERTA barra sempre. Falta de unidade barra so quando
-- nao houver divergencia LIBERADA nesta conferencia. Foi para isso que o
-- lider veio ate a bancada e digitou o PIN.

create or replace function public.concluir_conferencia(
  p_conferencia_id uuid,
  p_operador_id uuid default null
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pacote uuid;
  v_faltando integer;
  v_abertas integer;
  v_liberadas integer;
begin
  select pacote_id into v_pacote
  from public.conferencias
  where id = p_conferencia_id and situacao = 'em_andamento';

  if not found then
    return query select false, 'conferencia_nao_aberta';
    return;
  end if;

  select count(*) into v_abertas
  from public.divergencias
  where conferencia_id = p_conferencia_id and liberada_em is null;

  if v_abertas > 0 then
    return query select false, 'divergencia_aberta';
    return;
  end if;

  select count(*) into v_faltando
  from public.conferencia_itens
  where conferencia_id = p_conferencia_id
    and quantidade_lida < quantidade_esperada;

  if v_faltando > 0 then
    select count(*) into v_liberadas
    from public.divergencias
    where conferencia_id = p_conferencia_id and liberada_em is not null;

    -- Sem alguem ter assumido a diferenca, nao fecha.
    if v_liberadas = 0 then
      return query select false, 'faltam_unidades';
      return;
    end if;
  end if;

  update public.conferencias
     set situacao = 'concluida',
         concluida_em = now(),
         concluida_por = p_operador_id
   where id = p_conferencia_id;

  update public.pacotes set etapa = 'pronto' where id = v_pacote;

  return query select true, 'ok';
end;
$$;

comment on function public.concluir_conferencia is
  'Fecha a conferencia. Diferenca de contagem so passa com divergencia liberada por lider — a liberacao e a autorizacao, senao ela nao serviria para nada.';
