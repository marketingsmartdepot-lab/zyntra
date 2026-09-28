-- Bipar e fechar a separação no coletor.
--
-- (As duas primeiras funções foram recriadas segundos depois pela migração
--  20260928192924: o parâmetro de saída `sku_id` colidia com a coluna `sku_id`
--  no `on conflict`. `fechar_separacao` nasceu aqui e não mudou.)

create or replace function public.fechar_separacao(p_lista_id uuid)
returns table(ok boolean, motivo text, pedidos integer, faltando jsonb)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_faltando jsonb;
  v_n integer;
begin
  perform public.exige_perfil_ativo();

  if not exists (
    select 1 from public.listas_separacao ls
    where ls.id = p_lista_id and ls.situacao = 'em_separacao'
  ) then
    return query select false, 'lista_nao_esta_em_separacao', 0, null::jsonb;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', sp.codigo, 'descricao', sp.descricao,
           'separado', sp.separado, 'esperado', sp.esperado)), '[]'::jsonb)
    into v_faltando
  from public.separacao_progresso sp
  where sp.lista_id = p_lista_id and not sp.completo;

  -- TRAVA até estar tudo verde, por escolha dela contra a minha recomendação:
  -- caixa certa vale mais que corredor livre. Faltou produto na prateleira, a
  -- lista não fecha — o problema sobe para quem pode resolver em vez de virar
  -- uma caixa incompleta na esteira.
  if jsonb_array_length(v_faltando) > 0 then
    return query select false, 'faltam_itens', 0, v_faltando;
    return;
  end if;

  update public.pacotes pa
     set etapa = 'conferir'
   where pa.id in (
     select lp.pacote_id from public.listas_pacotes lp where lp.lista_id = p_lista_id
   )
     and pa.etapa = 'separar';

  get diagnostics v_n = row_count;

  -- Solta o cadeado só agora: durante a separação ele é que impedia a mesma
  -- caixa entrar noutra lista.
  update public.listas_pacotes set ativa = false where lista_id = p_lista_id;

  update public.listas_separacao
     set situacao = 'concluida', concluida_em = now()
   where id = p_lista_id;

  return query select true, 'ok', v_n, '[]'::jsonb;
end;
$fn$;

revoke all on function public.fechar_separacao(uuid) from public;
grant execute on function public.fechar_separacao(uuid) to authenticated;
