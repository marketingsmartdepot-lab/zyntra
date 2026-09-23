-- ZYNTRA — listas de separação e conferência por bipagem
--
-- Três regras moram aqui, e vale escrever qual é qual porque elas se parecem
-- e não são a mesma coisa:
--
--  1. Um PACOTE não pode estar em duas listas ativas. Um SKU pode e deve
--     estar em várias — é o mesmo produto em pedidos diferentes.
--
--  2. Bipar o mesmo código duas vezes CONTA DUAS, e tem que contar: o pedido
--     pede 2 unidades, o operador bipa 2. O que não conta duas é a mesma
--     leitura reenviada por falha de rede — e isso se resolve com chave de
--     idempotência, não ignorando código repetido. Passar da quantidade
--     esperada é unidade excedente, e é recusado.
--
--  3. A conferência não fecha com divergência aberta, e liberar divergência
--     é do líder.

-- ------------------------------------------------- listas de separação

create sequence public.listas_separacao_seq;

create table public.listas_separacao (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default 'LS-' || lpad(nextval('public.listas_separacao_seq')::text, 4, '0'),
  separador_id uuid references public.operadores (id) on delete set null,
  situacao text not null default 'aguardando'
    check (situacao in ('aguardando', 'em_execucao', 'concluida', 'cancelada')),
  criada_por uuid references public.perfis (id) on delete set null,
  criada_em timestamptz not null default now(),
  iniciada_em timestamptz,
  concluida_em timestamptz,
  atualizado_em timestamptz not null default now()
);

comment on table public.listas_separacao is
  'Lista do separador. Pode cruzar contas e empresas: quem anda pelo corredor não quer uma lista por CNPJ.';

create trigger listas_separacao_atualizado_em
  before update on public.listas_separacao
  for each row execute function public.tocar_atualizado_em();

create table public.listas_pacotes (
  lista_id uuid not null references public.listas_separacao (id) on delete cascade,
  pacote_id uuid not null references public.pacotes (id) on delete cascade,
  -- Denormalizado de propósito: é o que permite o índice parcial abaixo
  -- garantir a regra no banco, sem corrida entre checar e inserir.
  ativa boolean not null default true,
  adicionado_em timestamptz not null default now(),
  primary key (lista_id, pacote_id)
);

comment on column public.listas_pacotes.ativa is
  'Espelha a situação da lista. Existe para o índice parcial poder proibir o mesmo pacote em duas listas ativas.';

-- REGRA 1, garantida pelo banco.
create unique index pacote_em_uma_lista_ativa_idx
  on public.listas_pacotes (pacote_id) where ativa;

create index listas_pacotes_lista_idx on public.listas_pacotes (lista_id);

-- Lista concluída ou cancelada solta os pacotes, senão eles ficariam presos
-- para sempre e nenhuma lista nova poderia incluí-los.
create or replace function public.sincronizar_lista_ativa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.situacao in ('concluida', 'cancelada')
     and old.situacao not in ('concluida', 'cancelada') then
    update public.listas_pacotes set ativa = false where lista_id = new.id;
  end if;
  return new;
end;
$$;

create trigger listas_separacao_situacao
  after update of situacao on public.listas_separacao
  for each row execute function public.sincronizar_lista_ativa();

-- ------------------------------------------------------- conferências

create table public.conferencias (
  id uuid primary key default gen_random_uuid(),
  pacote_id uuid not null references public.pacotes (id) on delete cascade,
  estacao_id uuid references public.estacoes (id) on delete set null,
  sessao_id uuid references public.sessoes_estacao (id) on delete set null,
  situacao text not null default 'em_andamento'
    check (situacao in ('em_andamento', 'concluida', 'cancelada')),
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz,
  concluida_por uuid references public.operadores (id) on delete set null
);

comment on table public.conferencias is
  'Uma passagem do pacote pela bancada. Um pacote pode ser conferido de novo depois de devolvido, então não é um-para-um.';

-- Um pacote não fica aberto em duas estações ao mesmo tempo.
create unique index conferencia_aberta_por_pacote_idx
  on public.conferencias (pacote_id) where situacao = 'em_andamento';

create index conferencias_pacote_idx on public.conferencias (pacote_id);

-- O que tem que estar na caixa, congelado no início da conferência e já
-- expandido por kit. Congelado porque o catálogo pode mudar no meio, e a
-- caixa que o operador tem na mão é a de agora.
create table public.conferencia_itens (
  id uuid primary key default gen_random_uuid(),
  conferencia_id uuid not null references public.conferencias (id) on delete cascade,
  sku_id uuid not null references public.skus (id) on delete restrict,
  quantidade_esperada integer not null check (quantidade_esperada > 0),
  quantidade_lida integer not null default 0 check (quantidade_lida >= 0),
  unique (conferencia_id, sku_id)
);

-- --------------------------------------------------------------- leituras

create table public.leituras (
  id uuid primary key default gen_random_uuid(),
  conferencia_id uuid not null references public.conferencias (id) on delete cascade,
  -- REGRA 2: a chave vem do cliente (sessão + sequência do leitor). A mesma
  -- leitura reenviada traz a mesma chave e não conta de novo. Bipadas
  -- diferentes do mesmo código trazem chaves diferentes e contam as duas.
  chave_cliente text not null,
  codigo_lido text not null,
  sku_id uuid references public.skus (id) on delete set null,
  resultado text not null
    check (resultado in ('ok', 'nao_pertence', 'excedente', 'desconhecido')),
  operador_id uuid references public.operadores (id) on delete set null,
  lida_em timestamptz not null default now(),
  unique (conferencia_id, chave_cliente)
);

comment on column public.leituras.chave_cliente is
  'Idempotência da bancada: Wi-Fi de galpão cai, e o reenvio não pode virar unidade a mais.';

create index leituras_conferencia_idx on public.leituras (conferencia_id, lida_em);

-- ----------------------------------------------------------- divergências

create table public.divergencias (
  id uuid primary key default gen_random_uuid(),
  conferencia_id uuid not null references public.conferencias (id) on delete cascade,
  tipo text not null check (tipo in ('falta', 'excedente', 'item_errado', 'avaria')),
  detalhe text,
  aberta_em timestamptz not null default now(),
  aberta_por uuid references public.operadores (id) on delete set null,
  liberada_em timestamptz,
  liberada_por uuid references public.operadores (id) on delete set null,
  motivo_liberacao text
);

comment on table public.divergencias is
  'O que o operador não consegue resolver sozinho. Liberar é do líder, e fica registrado quem liberou e por quê.';

create index divergencias_abertas_idx
  on public.divergencias (conferencia_id) where liberada_em is null;

-- ------------------------------------------------- abrir a conferência

create or replace function public.abrir_conferencia(
  p_pacote_id uuid,
  p_estacao_id uuid default null,
  p_sessao_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conf uuid;
  v_itens integer;
begin
  if not exists (
    select 1 from public.pacotes where id = p_pacote_id and etapa = 'conferir'
  ) then
    raise exception 'O pacote nao esta na etapa de conferencia.'
      using errcode = 'check_violation';
  end if;

  select id into v_conf
  from public.conferencias
  where pacote_id = p_pacote_id and situacao = 'em_andamento';

  if found then
    return v_conf;
  end if;

  insert into public.conferencias (pacote_id, estacao_id, sessao_id)
  values (p_pacote_id, p_estacao_id, p_sessao_id)
  returning id into v_conf;

  -- Congela o esperado, já explodindo kit.
  insert into public.conferencia_itens (conferencia_id, sku_id, quantidade_esperada)
  select v_conf, e.sku_id, sum(e.quantidade)::integer
  from public.pacotes pa
  join public.pedidos p on p.envio_id = pa.envio_id
  join public.pedido_itens i on i.pedido_id = p.id
  join public.mapeamentos_anuncio m
    on m.conta_id = p.conta_id
   and m.ref_anuncio = i.ref_anuncio
   and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
  cross join lateral public.explodir_sku(m.sku_id, i.quantidade) e
  where pa.id = p_pacote_id
  group by e.sku_id;

  get diagnostics v_itens = row_count;

  if v_itens = 0 then
    raise exception
      'Nenhum item com SKU mapeado neste pacote: a conferencia nao teria o que validar.'
      using errcode = 'no_data_found';
  end if;

  return v_conf;
end;
$$;

comment on function public.abrir_conferencia is
  'Abre a bancada para um pacote e congela o esperado. Recusa pacote sem SKU mapeado: conferir sem saber o que esperar e teatro.';

-- ------------------------------------------------------ registrar leitura

create or replace function public.registrar_leitura(
  p_conferencia_id uuid,
  p_codigo text,
  p_chave_cliente text,
  p_operador_id uuid default null
)
returns table (
  resultado text,
  sku_id uuid,
  descricao text,
  lidas integer,
  esperadas integer,
  faltam integer,
  repetida boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sku uuid;
  v_item public.conferencia_itens%rowtype;
  v_res text;
  v_anterior public.leituras%rowtype;
begin
  if not exists (
    select 1 from public.conferencias
    where id = p_conferencia_id and situacao = 'em_andamento'
  ) then
    raise exception 'Conferencia nao esta aberta.' using errcode = 'check_violation';
  end if;

  -- Reenvio da mesma leitura: devolve a resposta de antes, sem contar de novo.
  select * into v_anterior
  from public.leituras
  where conferencia_id = p_conferencia_id and chave_cliente = p_chave_cliente;

  if found then
    select * into v_item from public.conferencia_itens
     where conferencia_id = p_conferencia_id and sku_id = v_anterior.sku_id;

    return query
    select v_anterior.resultado, v_anterior.sku_id,
           (select s.descricao from public.skus s where s.id = v_anterior.sku_id),
           coalesce(v_item.quantidade_lida, 0),
           coalesce(v_item.quantidade_esperada, 0),
           greatest(coalesce(v_item.quantidade_esperada, 0) - coalesce(v_item.quantidade_lida, 0), 0),
           true;
    return;
  end if;

  select c.sku_id into v_sku
  from public.sku_codigos_barras c
  where c.codigo = p_codigo;

  if v_sku is null then
    v_res := 'desconhecido';
  else
    select * into v_item
    from public.conferencia_itens
    where conferencia_id = p_conferencia_id and sku_id = v_sku;

    if not found then
      v_res := 'nao_pertence';
    elsif v_item.quantidade_lida >= v_item.quantidade_esperada then
      v_res := 'excedente';
    else
      v_res := 'ok';
    end if;
  end if;

  insert into public.leituras
    (conferencia_id, chave_cliente, codigo_lido, sku_id, resultado, operador_id)
  values
    (p_conferencia_id, p_chave_cliente, p_codigo, v_sku, v_res, p_operador_id);

  if v_res = 'ok' then
    update public.conferencia_itens
       set quantidade_lida = quantidade_lida + 1
     where conferencia_id = p_conferencia_id and sku_id = v_sku
    returning * into v_item;
  end if;

  return query
  select v_res, v_sku,
         (select s.descricao from public.skus s where s.id = v_sku),
         coalesce(v_item.quantidade_lida, 0),
         coalesce(v_item.quantidade_esperada, 0),
         greatest(coalesce(v_item.quantidade_esperada, 0) - coalesce(v_item.quantidade_lida, 0), 0),
         false;
end;
$$;

comment on function public.registrar_leitura is
  'Um bipe. Mesmo codigo bipado de novo conta de novo; a MESMA leitura reenviada nao.';

-- ----------------------------------------------------- fechar a conferência

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
  v_divergencias integer;
begin
  select pacote_id into v_pacote
  from public.conferencias
  where id = p_conferencia_id and situacao = 'em_andamento';

  if not found then
    return query select false, 'conferencia_nao_aberta';
    return;
  end if;

  select count(*) into v_faltando
  from public.conferencia_itens
  where conferencia_id = p_conferencia_id
    and quantidade_lida < quantidade_esperada;

  if v_faltando > 0 then
    return query select false, 'faltam_unidades';
    return;
  end if;

  select count(*) into v_divergencias
  from public.divergencias
  where conferencia_id = p_conferencia_id and liberada_em is null;

  if v_divergencias > 0 then
    return query select false, 'divergencia_aberta';
    return;
  end if;

  update public.conferencias
     set situacao = 'concluida',
         concluida_em = now(),
         concluida_por = p_operador_id
   where id = p_conferencia_id;

  -- REGRA 3: só aqui o pacote fica pronto — e é o único caminho para a
  -- impressão sair, porque imprimir exige conferência concluída.
  update public.pacotes set etapa = 'pronto' where id = v_pacote;

  return query select true, 'ok';
end;
$$;

comment on function public.concluir_conferencia is
  'Fecha a bancada. Recusa com unidade faltando ou divergencia aberta - e e o unico caminho para o pacote ficar pronto.';

create or replace function public.liberar_divergencia(
  p_divergencia_id uuid,
  p_lider_id uuid,
  p_motivo text
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.operadores
    where id = p_lider_id and papel = 'lider' and ativo
  ) then
    return query select false, 'nao_e_lider';
    return;
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    return query select false, 'motivo_obrigatorio';
    return;
  end if;

  update public.divergencias
     set liberada_em = now(),
         liberada_por = p_lider_id,
         motivo_liberacao = p_motivo
   where id = p_divergencia_id and liberada_em is null;

  if not found then
    return query select false, 'divergencia_nao_encontrada';
    return;
  end if;

  return query select true, 'ok';
end;
$$;

comment on function public.liberar_divergencia is
  'So lider libera, e so com motivo. Divergencia liberada em silencio e divergencia escondida.';

-- ------------------------------------------------------------------- RLS

alter table public.listas_separacao enable row level security;
alter table public.listas_pacotes enable row level security;
alter table public.conferencias enable row level security;
alter table public.conferencia_itens enable row level security;
alter table public.leituras enable row level security;
alter table public.divergencias enable row level security;

create policy "equipe lê listas" on public.listas_separacao
  for select to authenticated using (true);
create policy "equipe escreve listas" on public.listas_separacao
  for all to authenticated
  using (public.papel_atual() in ('operador','lider','admin'))
  with check (public.papel_atual() in ('operador','lider','admin'));

create policy "equipe lê listas_pacotes" on public.listas_pacotes
  for select to authenticated using (true);
create policy "equipe escreve listas_pacotes" on public.listas_pacotes
  for all to authenticated
  using (public.papel_atual() in ('operador','lider','admin'))
  with check (public.papel_atual() in ('operador','lider','admin'));

create policy "equipe lê conferências" on public.conferencias
  for select to authenticated using (true);
create policy "equipe lê itens conferidos" on public.conferencia_itens
  for select to authenticated using (true);
create policy "equipe lê leituras" on public.leituras
  for select to authenticated using (true);
create policy "equipe lê divergências" on public.divergencias
  for select to authenticated using (true);
create policy "equipe abre divergência" on public.divergencias
  for insert to authenticated
  with check (public.papel_atual() in ('operador','lider','admin'));

revoke all on function public.abrir_conferencia(uuid, uuid, uuid) from public, anon;
revoke all on function public.registrar_leitura(uuid, text, text, uuid) from public, anon;
revoke all on function public.concluir_conferencia(uuid, uuid) from public, anon;
revoke all on function public.liberar_divergencia(uuid, uuid, text) from public, anon;
grant execute on function public.abrir_conferencia(uuid, uuid, uuid) to authenticated;
grant execute on function public.registrar_leitura(uuid, text, text, uuid) to authenticated;
grant execute on function public.concluir_conferencia(uuid, uuid) to authenticated;
grant execute on function public.liberar_divergencia(uuid, uuid, text) to authenticated;
