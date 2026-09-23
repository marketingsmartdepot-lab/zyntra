-- A estacao de saida: abrir a relacao e bipar contra ela.
--
-- A doca registra quem TROUXE o pacote para fora da expedicao. A saida
-- registra quem LEVOU o pacote para fora do galpao — e e aqui que o custo da
-- etiqueta do Flex e congelado, um por pacote bipado.

-- Uma saida por vez, por modalidade. Duas saidas abertas para o mesmo destino
-- fariam o operador bipar na relacao errada sem perceber.
create unique index if not exists saidas_uma_aberta_por_modalidade
  on public.saidas (modalidade_id)
  where situacao = 'em_andamento';

create or replace function public.abrir_saida(
  p_modalidade_id uuid,
  p_motorista text default null
)
returns table (ok boolean, motivo text, saida_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_sigla text;
  v_codigo text;
begin
  if p_modalidade_id is null then
    return query select false, 'modalidade_nao_informada', null::uuid;
    return;
  end if;

  select s.id into v_id
  from public.saidas s
  where s.modalidade_id = p_modalidade_id and s.situacao = 'em_andamento';

  -- Ja aberta nao e erro: o operador voltou para a mesma relacao.
  if found then
    return query select true, 'ja_aberta', v_id;
    return;
  end if;

  select upper(left(regexp_replace(m.nome, '[^a-zA-Z]', '', 'g'), 3))
    into v_sigla
  from public.modalidades m where m.id = p_modalidade_id;

  if v_sigla is null then
    return query select false, 'modalidade_nao_encontrada', null::uuid;
    return;
  end if;

  v_codigo := coalesce(nullif(v_sigla, ''), 'SAI')
    || '-' || to_char(now() at time zone 'America/Sao_Paulo', 'DDMM')
    || '-' || lpad((
         select (count(*) + 1)::text from public.saidas s2
         where s2.aberta_em::date = (now() at time zone 'America/Sao_Paulo')::date
       ), 3, '0');

  insert into public.saidas (codigo, modalidade_id, motorista, situacao, aberta_por)
  values (v_codigo, p_modalidade_id,
          nullif(trim(coalesce(p_motorista, '')), ''),
          'em_andamento', auth.uid())
  returning id into v_id;

  return query select true, 'ok', v_id;
end;
$$;

comment on function public.abrir_saida is
  'Abre a relacao de saida de um destino. Se ja houver uma aberta, devolve a mesma: o operador voltou para ela, nao pediu outra.';

-- O operador bipa a ETIQUETA, nao digita uuid. Resolver o codigo aqui e nao no
-- navegador evita duas idas ao servidor e, principalmente, evita que a resposta
-- "nao achei" e a gravacao aconteçam em instantes diferentes.
create or replace function public.bipar_saida_por_codigo(
  p_saida_id uuid,
  p_codigo text,
  p_operador_id uuid default null
)
returns table (ok boolean, motivo text, custo numeric, pacote_id uuid, codigo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_pacote uuid;
  v_mod_pacote uuid;
  v_mod_saida uuid;
  v_nome_mod text;
  v_r record;
begin
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

  -- A etiqueta pode carregar a referencia do envio, do pedido ou do pack.
  -- Todas resolvem para o mesmo pacote.
  select pa.id into v_pacote
  from public.pacotes pa
  join public.envios e on e.id = pa.envio_id
  where upper(e.ref_externa) = v_codigo
  limit 1;

  if v_pacote is null then
    select pa.id into v_pacote
    from public.pacotes pa
    join public.pedidos p on p.envio_id = pa.envio_id
    where upper(p.ref_externa) = v_codigo
       or upper(p.pack_ref) = v_codigo
    limit 1;
  end if;

  if v_pacote is null then
    return query select false, 'codigo_desconhecido', null::numeric, null::uuid, v_codigo;
    return;
  end if;

  -- Bipou na relacao errada: dizer QUAL e a certa, senao o operador fica
  -- tentando de novo achando que o leitor falhou.
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

  return query select v_r.ok, v_r.motivo, v_r.custo, v_pacote, v_codigo;
end;
$$;

comment on function public.bipar_saida_por_codigo is
  'Bipa pela etiqueta. Resolve envio, pedido ou pack para o mesmo pacote, e recusa dizendo qual e a relacao certa quando o destino nao bate.';

revoke all on function public.abrir_saida(uuid, text) from public;
revoke all on function public.bipar_saida_por_codigo(uuid, text, uuid) from public;
grant execute on function public.abrir_saida(uuid, text) to authenticated;
grant execute on function public.bipar_saida_por_codigo(uuid, text, uuid) to authenticated;
