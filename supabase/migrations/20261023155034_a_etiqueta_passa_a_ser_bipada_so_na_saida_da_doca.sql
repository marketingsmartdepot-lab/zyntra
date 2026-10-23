-- A etiqueta passa a ser bipada UMA vez, na saida da doca. Decisao da Daniele
-- em 23/10, depois de encontrar a trava na pratica.
--
-- Como estava: a etiqueta tinha que ser bipada na BANCADA, na aba Pronto, e
-- sem isso a caixa nao entrava no carrinho da doca. Isso nasceu de um fluxo em
-- que alguem passava pela aba Pronto. Nao passa mais: agora a etiqueta sai no
-- bipe que fecha a caixa e a tela ja vai para a proxima. O passo ficou sem
-- momento, e aparecia so depois, como um bloqueio na doca — com a caixa
-- pronta, o papel impresso, e ninguem entendendo o que faltava.
--
-- O bipe da porta (`bipar_saida_por_codigo`) ja le o codigo da etiqueta: e
-- `pacote_por_codigo` que acha a caixa a partir do que foi bipado. Entao ele
-- JA e a prova de que o papel existe. Passa a ser ele quem carimba a
-- confirmacao, em vez de exigi-la de alguem antes.
--
-- O QUE SE PERDE, escrito aqui porque some do radar depois:
--
-- A confirmacao na bancada provava que a etiqueta na mao era a da caixa ABERTA
-- NA FRENTE do operador — o sistema sabia qual caixa era, pela conferencia. Na
-- porta isso nao da: o bipe DESCOBRE a caixa a partir da etiqueta, entao duas
-- etiquetas trocadas entre duas caixas resolvem cada uma para a sua e ninguem
-- percebe. Essa checagem deixa de existir.
--
-- Fica a prova de que papel existe: nao se bipa etiqueta que nao foi impressa.
-- O que NAO fica e a recusa de deixar sair caixa cuja etiqueta nunca saiu —
-- hoje a porta nao verifica isso, e eu nao vou inventar uma trava nova sem
-- pedido.

-- ------------------------------------------- 1. o carrinho da lista libera
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
$function$;

-- --------------------------------------------- 2. o bipe da doca libera
create or replace function public.bipar_entrega_doca(p_entrega_id uuid, p_codigo text)
returns table (ok boolean, motivo text, pacote_id uuid, codigo text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_pacote uuid;
  v_etapa text;
  v_outra text;
begin
  perform public.exige_perfil_ativo();
  if v_codigo = '' then
    return query select false, 'codigo_vazio', null::uuid, null::text;
    return;
  end if;

  if not exists (select 1 from public.entregas_doca ed where ed.id = p_entrega_id) then
    return query select false, 'entrega_nao_encontrada', null::uuid, v_codigo;
    return;
  end if;

  v_pacote := public.pacote_por_codigo(v_codigo);

  if v_pacote is null then
    return query select false, 'codigo_desconhecido', null::uuid, v_codigo;
    return;
  end if;

  -- Ja esta nesta entrega: o operador se perdeu na pilha. Nao e erro.
  if exists (
    select 1 from public.entregas_doca_pacotes ep
    where ep.entrega_id = p_entrega_id and ep.pacote_id = v_pacote
  ) then
    return query select true, 'ja_bipado', v_pacote, v_codigo;
    return;
  end if;

  -- Antes de olhar a doca: esta caixa ja foi embora?
  if exists (select 1 from public.saida_pacotes sp where sp.pacote_id = v_pacote) then
    return query select false, 'ja_saiu_do_galpao', v_pacote, v_codigo;
    return;
  end if;

  select ed.codigo into v_outra
  from public.entregas_doca_pacotes ep
  join public.entregas_doca ed on ed.id = ep.entrega_id
  where ep.pacote_id = v_pacote
  limit 1;

  if found then
    return query select false, 'ja_na_doca_em_' || v_outra, v_pacote, v_codigo;
    return;
  end if;

  select pa.etapa::text into v_etapa
  from public.pacotes pa
  where pa.id = v_pacote;

  if v_etapa <> 'pronto' then
    return query select false, 'pacote_nao_esta_pronto', v_pacote, v_codigo;
    return;
  end if;

  -- A exigencia de etiqueta confirmada saiu daqui: ela acontece no bipe da
  -- porta, que e o unico bipe de etiqueta que existe agora.

  insert into public.entregas_doca_pacotes (entrega_id, pacote_id)
  values (p_entrega_id, v_pacote);

  return query select true, 'ok', v_pacote, v_codigo;
end;
$function$;

-- ------------------------------------- 3. a entrega em lote tambem libera
create or replace function public.entregar_selecionados_na_doca(
  p_entrega_id uuid, p_pacote_ids uuid[])
returns table (ok boolean, motivo text, entraram integer, recusados jsonb)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_etapa text;
  v_outra text;
  v_codigo text;
  v_n integer := 0;
  v_recusados jsonb := '[]'::jsonb;
  v_motivo text;
begin
  perform public.exige_perfil_ativo();

  if not exists (select 1 from public.entregas_doca ed where ed.id = p_entrega_id) then
    return query select false, 'entrega_nao_encontrada', 0, null::jsonb;
    return;
  end if;

  if p_pacote_ids is null or array_length(p_pacote_ids, 1) is null then
    return query select true, 'nada_selecionado', 0, '[]'::jsonb;
    return;
  end if;

  foreach v_id in array p_pacote_ids loop
    v_motivo := null;

    select coalesce(pe.ref_externa, e.ref_externa)
      into v_codigo
    from public.pacotes pa
    join public.envios e on e.id = pa.envio_id
    left join public.pedidos pe on pe.envio_id = e.id
    where pa.id = v_id
    limit 1;

    -- Ja esta neste carrinho: nao e erro, e a pessoa marcando duas vezes.
    if exists (
      select 1 from public.entregas_doca_pacotes ep
      where ep.entrega_id = p_entrega_id and ep.pacote_id = v_id
    ) then
      v_n := v_n + 1;
      continue;
    end if;

    if exists (select 1 from public.saida_pacotes sp where sp.pacote_id = v_id) then
      v_motivo := 'ja saiu do galpao';
    else
      select ed.codigo into v_outra
      from public.entregas_doca_pacotes ep
      join public.entregas_doca ed on ed.id = ep.entrega_id
      where ep.pacote_id = v_id
      limit 1;

      if v_outra is not null then
        v_motivo := 'ja esta no carrinho ' || v_outra;
      end if;
    end if;

    if v_motivo is null then
      select pa.etapa::text into v_etapa
      from public.pacotes pa
      where pa.id = v_id;

      if v_etapa is null then
        v_motivo := 'pacote nao encontrado';
      elsif v_etapa <> 'pronto' then
        v_motivo := 'nao esta pronto pra envio';
      end if;
      -- 'etiqueta ainda nao foi confirmada' saiu: quem confirma e a porta.
    end if;

    if v_motivo is not null then
      v_recusados := v_recusados || jsonb_build_object(
        'codigo', coalesce(v_codigo, 'sem codigo'), 'motivo', v_motivo);
      continue;
    end if;

    insert into public.entregas_doca_pacotes (entrega_id, pacote_id)
    values (p_entrega_id, v_id);

    v_n := v_n + 1;
  end loop;

  return query select true, 'ok', v_n, v_recusados;
end;
$function$;

-- --------------------------- 4. o bipe da porta passa a ser a confirmacao
create or replace function public.bipar_saida_por_codigo(
  p_saida_id uuid, p_codigo text, p_operador_id uuid default null)
returns table (ok boolean, motivo text, custo numeric, pacote_id uuid, codigo text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_pacote uuid;
  v_mod_pacote uuid;
  v_mod_saida uuid;
  v_nome_mod text;
  v_r record;
begin
  perform public.exige_perfil_ativo();
  if v_codigo = '' then
    return query select false, 'codigo_vazio', null::numeric, null::uuid, null::text;
    return;
  end if;

  select s.modalidade_id into v_mod_saida
  from public.saidas s
  where s.id = p_saida_id and s.situacao = 'em_andamento';

  if not found then
    return query select false, 'saida_nao_aberta', null::numeric, null::uuid, null::text;
    return;
  end if;

  v_pacote := public.pacote_por_codigo(v_codigo);

  if v_pacote is null then
    return query select false, 'codigo_desconhecido', null::numeric, null::uuid, v_codigo;
    return;
  end if;

  select e.modalidade_id, m.nome into v_mod_pacote, v_nome_mod
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  left join public.modalidades m on m.id = e.modalidade_id
  where pa.id = v_pacote;

  if v_mod_pacote is distinct from v_mod_saida then
    return query select false,
      'outra_modalidade:' || coalesce(v_nome_mod, 'sem modalidade'),
      null::numeric, v_pacote, v_codigo;
    return;
  end if;

  select * into v_r from public.bipar_saida(p_saida_id, v_pacote, p_operador_id);

  -- ESTE bipe e a confirmacao da etiqueta. Quem esta na porta leu o papel que
  -- esta colado na caixa que esta saindo — nao ha prova melhor disponivel, e
  -- nao ha segundo bipe pedido a ninguem.
  --
  -- So carimba se a saida deu certo: caixa recusada na porta nao teve etiqueta
  -- conferida.
  if v_r.ok then
    update public.impressoes im
       set confirmada_em = now(),
           confirmada_codigo = v_codigo,
           operador_id = coalesce(p_operador_id, auth.uid(), im.operador_id)
     where im.pacote_id = v_pacote
       and im.tipo = 'etiqueta'
       and im.situacao = 'impressa'
       and im.confirmada_em is null;
  end if;

  return query select v_r.ok, v_r.motivo, v_r.custo, v_pacote, v_codigo;
end;
$function$;

comment on function public.bipar_saida_por_codigo is
  'O bipe da porta: manda a caixa embora e, no mesmo gesto, confirma a '
  'etiqueta. E o unico bipe de etiqueta do fluxo.';
