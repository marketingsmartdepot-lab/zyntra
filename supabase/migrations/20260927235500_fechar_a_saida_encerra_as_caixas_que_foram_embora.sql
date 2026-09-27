-- "Pronto pra envio" nunca esvaziava.
--
-- A etapa `encerrado` existe desde o começo, e a esteira até filtra por ela —
-- mas NENHUMA função punha um pacote lá. A caixa saía pela porta, virava
-- custo, entrava na minuta, e continuava listada em Pronto pra envio. Em duas
-- semanas de operação a aba ficaria inútil.
--
-- O momento certo de encerrar é o FECHAMENTO da saída, não o bipe: enquanto a
-- saída está aberta a caixa ainda está no galpão, em cima do palete ao lado da
-- porta, e um bipe errado se conserta não fechando. Fechar é o ato que tem
-- motorista e minuta — dali em diante a caixa não é mais problema daqui.
create or replace function public.fechar_saida(p_saida_id uuid)
returns table(ok boolean, motivo text, pacotes integer, total numeric)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_n integer;
  v_total numeric;
begin
  perform public.exige_perfil_ativo();
  if not exists (
    select 1 from public.saidas s
    where s.id = p_saida_id and s.situacao = 'em_andamento'
  ) then
    return query select false, 'saida_nao_aberta', 0, 0::numeric;
    return;
  end if;

  select count(*), coalesce(sum(sp.custo_etiqueta), 0)
    into v_n, v_total
  from public.saida_pacotes sp
  where sp.saida_id = p_saida_id;

  if v_n = 0 then
    return query select false, 'saida_vazia', 0, 0::numeric;
    return;
  end if;

  update public.saidas s
     set situacao = 'fechada',
         fechada_em = now(),
         minuta_gerada_em = now()
   where s.id = p_saida_id;

  -- As caixas desta saída saem da esteira. O gatilho de transição já grava o
  -- evento no histórico do pacote, então o registro de quando e por quem não
  -- se perde — a caixa some da aba, não da memória.
  update public.pacotes pa
     set etapa = 'encerrado'
   where pa.id in (
     select sp.pacote_id from public.saida_pacotes sp where sp.saida_id = p_saida_id
   )
     and pa.etapa <> 'encerrado';

  return query select true, 'ok', v_n, v_total;
end;
$fn$;

revoke all on function public.fechar_saida(uuid) from public;
grant execute on function public.fechar_saida(uuid) to authenticated;
