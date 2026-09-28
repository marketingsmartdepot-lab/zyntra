-- O carrinho da doca deixa de ser um agrupamento à parte: ELE É A LISTA.
--
-- Antes, a mesma pilha física era agrupada duas vezes — a lista de separação
-- (que já sabe quem separou e quais caixas são) e, depois, um carrinho criado
-- à mão, com o nome redigitado e cada caixa bipada de novo. Ela pediu para as
-- duas pontas casarem: "a CRISTINA ta com a lista 011, entao quando ela
-- finalizar e proximo tem que casar com essa lista".
--
-- Agora, a cada "Finalizar e próximo", a caixa entra sozinha no carrinho da
-- lista dela. O carrinho nasce na PRIMEIRA caixa que entra — lista cujas
-- caixas ficam todas barradas não cria carrinho vazio.
--
-- A trava da etiqueta continua valendo, por escolha dela: caixa sem impressão
-- confirmada não entra. Fica de fora, e a tela mostra qual ficou.

alter table public.entregas_doca
  add column if not exists lista_id uuid references public.listas_separacao(id) on delete set null;

comment on column public.entregas_doca.lista_id is
  'A lista de separação que este carrinho É. Nulo = carrinho avulso, montado à '
  'mão na tela de Pronto pra envio.';

create unique index if not exists entregas_doca_um_carrinho_por_lista
  on public.entregas_doca (lista_id) where lista_id is not null;

/**
 * Põe a caixa no carrinho da lista dela, se puder.
 *
 * Silenciosa de propósito: é chamada no fim da conferência, e a conferência
 * não pode falhar porque a etiqueta ainda não foi confirmada. A caixa fica de
 * fora e alguém a leva depois — pela tela de Pronto pra envio, que aplica as
 * mesmas regras.
 */
create or replace function public.caixa_entra_no_carrinho_da_lista(p_pacote_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_lista uuid;
  v_codigo text;
  v_quem text;
  v_entrega uuid;
  v_gera_etiqueta boolean;
begin
  select lp.lista_id into v_lista
  from public.listas_pacotes lp
  where lp.pacote_id = p_pacote_id
  order by lp.adicionado_em desc
  limit 1;

  if v_lista is null then
    return null;
  end if;

  -- Já saiu do galpão ou já está num carrinho: não mexe.
  if exists (select 1 from public.saida_pacotes sp where sp.pacote_id = p_pacote_id)
     or exists (select 1 from public.entregas_doca_pacotes ep where ep.pacote_id = p_pacote_id) then
    return null;
  end if;

  select coalesce(m.gera_etiqueta, false) into v_gera_etiqueta
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  left join public.modalidades m on m.id = e.modalidade_id
  where pa.id = p_pacote_id;

  if v_gera_etiqueta and not exists (
    select 1 from public.impressoes im
    where im.pacote_id = p_pacote_id
      and im.tipo = 'etiqueta'
      and im.confirmada_em is not null
  ) then
    return null;
  end if;

  select ed.id into v_entrega
  from public.entregas_doca ed where ed.lista_id = v_lista;

  if v_entrega is null then
    select ls.codigo, coalesce(nullif(btrim(pf.nome), ''), pf.email, 'sem separador')
      into v_codigo, v_quem
    from public.listas_separacao ls
    left join public.perfis pf on pf.id = ls.separador_id
    where ls.id = v_lista;

    insert into public.entregas_doca (codigo, entregue_por, lista_id, registrada_por)
    values (v_codigo, v_quem, v_lista, auth.uid())
    returning id into v_entrega;
  end if;

  insert into public.entregas_doca_pacotes (entrega_id, pacote_id)
  values (v_entrega, p_pacote_id)
  on conflict do nothing;

  return v_entrega;
end;
$fn$;

revoke all on function public.caixa_entra_no_carrinho_da_lista(uuid) from public, anon, authenticated;

-- "Finalizar e próximo" passa a fazer as duas coisas no mesmo ato: fecha a
-- conferência e põe a caixa no carrinho da lista.
create or replace function public.concluir_conferencia(p_conferencia_id uuid)
returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_pacote uuid;
  v_faltando integer;
  v_abertas integer;
  v_liberadas integer;
begin
  perform public.exige_perfil_ativo();
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

    if v_liberadas = 0 then
      return query select false, 'faltam_unidades';
      return;
    end if;
  end if;

  update public.conferencias
     set situacao = 'concluida',
         concluida_em = now(),
         concluida_por = auth.uid()
   where id = p_conferencia_id;

  update public.pacotes set etapa = 'pronto' where id = v_pacote;

  perform public.caixa_entra_no_carrinho_da_lista(v_pacote);

  return query select true, 'ok';
end;
$fn$;

revoke all on function public.concluir_conferencia(uuid) from public;
grant execute on function public.concluir_conferencia(uuid) to authenticated;
