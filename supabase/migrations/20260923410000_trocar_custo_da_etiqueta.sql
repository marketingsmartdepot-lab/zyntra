-- Trocar o custo da etiqueta FECHA o anterior em vez de sobrescrever.
--
-- O valor e congelado no instante do bipe de saida. Sobrescrever a linha faria
-- as saidas antigas continuarem com o valor certo em `saida_pacotes` mas sem
-- nada que explicasse de onde ele veio — e no fechamento do mes alguem olharia
-- R$ 11,99 numa saida e R$ 12,90 na tabela sem entender.
--
-- Entao o historico e uma linha por vigencia: a anterior ganha data de fim, a
-- nova comeca no dia escolhido.

create or replace function public.definir_custo_etiqueta(
  p_modalidade_id uuid,
  p_valor numeric,
  p_vigente_de date default current_date
)
returns table (ok boolean, motivo text, custo_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual record;
  v_id uuid;
begin
  if coalesce(public.papel_atual()::text, '') not in ('admin') then
    return query select false, 'sem_permissao', null::uuid;
    return;
  end if;

  if p_valor is null or p_valor < 0 then
    return query select false, 'valor_invalido', null::uuid;
    return;
  end if;

  if not exists (select 1 from public.modalidades m where m.id = p_modalidade_id) then
    return query select false, 'modalidade_nao_encontrada', null::uuid;
    return;
  end if;

  select * into v_atual
  from public.custos_etiqueta c
  where c.modalidade_id = p_modalidade_id and c.vigente_ate is null
  order by c.vigente_de desc
  limit 1;

  if found then
    -- Comecar antes do que ja vigora reescreveria o passado: o valor de uma
    -- saida ja registrada deixaria de bater com a tabela.
    if p_vigente_de <= v_atual.vigente_de then
      return query select false, 'data_anterior_a_vigente', null::uuid;
      return;
    end if;

    if v_atual.valor = p_valor then
      return query select true, 'valor_igual', v_atual.id;
      return;
    end if;

    update public.custos_etiqueta
       set vigente_ate = p_vigente_de - 1
     where id = v_atual.id;
  end if;

  insert into public.custos_etiqueta (modalidade_id, valor, vigente_de)
  values (p_modalidade_id, p_valor, p_vigente_de)
  returning id into v_id;

  return query select true, 'ok', v_id;
end;
$$;

comment on function public.definir_custo_etiqueta is
  'Abre uma nova vigencia e fecha a anterior. Nunca sobrescreve: o valor congelado numa saida antiga precisa continuar explicavel.';

revoke execute on function public.definir_custo_etiqueta(uuid, numeric, date) from public, anon;
grant execute on function public.definir_custo_etiqueta(uuid, numeric, date) to authenticated;
