-- O carrinho que nasce de uma lista gravava como "entregue por" o nome do
-- SEPARADOR da lista. Esta errado, e a Daniele corrigiu em 23/10: quem separa
-- normalmente nao e quem leva. Quem leva o carrinho para a doca e quem esta na
-- BANCADA — a pessoa que fechou a caixa e empurra o carrinho.
--
-- Isso importa porque esse nome tem um uso so: descobrir quem estava com a
-- caixa quando ela nao chega. Nome errado nao e detalhe de tela, e levar o
-- galpao a perguntar para a pessoa errada.
--
-- E o nome certo ja estava a mao: esta funcao e chamada por
-- `concluir_conferencia`, que roda como a pessoa que fechou a conferencia.
-- Entao `auth.uid()` aqui E a bancada. Eu estava buscando o separador na lista
-- quando a resposta estava na propria sessao.
--
-- CASO QUE FICA EM ABERTO, de proposito: um carrinho e um por LISTA, e duas
-- bancadas podem fechar caixas da mesma lista. O carrinho entao fica com o
-- nome de quem fechou a PRIMEIRA caixa. Nao invento rateio aqui — quem fechou
-- cada caixa esta gravado em `conferencias.concluida_por`, e da para mostrar
-- por caixa no dia em que isso incomodar.

create or replace function public.caixa_entra_no_carrinho_da_lista(p_pacote_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_lista uuid;
  v_codigo text;
  v_quem text;
  v_entrega uuid;
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

  -- Nao ha mais checagem de etiqueta confirmada aqui: quem confirma e o bipe
  -- da porta, depois.

  select ed.id into v_entrega
  from public.entregas_doca ed where ed.lista_id = v_lista;

  if v_entrega is null then
    -- O CODIGO do carrinho continua sendo o da lista: e por ele que o galpao
    -- liga o carrinho ao papel que o separador levou na mao.
    select ls.codigo into v_codigo
    from public.listas_separacao ls
    where ls.id = v_lista;

    -- QUEM LEVA e a bancada, e a bancada e quem esta chamando isto agora.
    select coalesce(nullif(btrim(pf.nome), ''), pf.email)
      into v_quem
    from public.perfis pf
    where pf.id = auth.uid();

    insert into public.entregas_doca (codigo, entregue_por, lista_id, registrada_por)
    values (v_codigo, coalesce(v_quem, 'sem nome'), v_lista, auth.uid())
    returning id into v_entrega;
  end if;

  insert into public.entregas_doca_pacotes (entrega_id, pacote_id)
  values (v_entrega, p_pacote_id)
  on conflict do nothing;

  return v_entrega;
end;
$function$;

comment on function public.caixa_entra_no_carrinho_da_lista is
  'A caixa conferida entra sozinha no carrinho da sua lista. O carrinho leva o '
  'codigo da lista e o nome de quem esta na BANCADA, que e quem o empurra.';
