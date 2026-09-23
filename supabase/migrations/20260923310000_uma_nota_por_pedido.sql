-- Uma nota por PEDIDO. Pedido com varios produtos, uma nota com varios itens.
--
-- A versao anterior agrupava por pacote: tres pedidos que saem na mesma caixa
-- viravam uma nota so. Estava errado. A unidade fiscal e a venda, e cada venda
-- tem a sua nota mesmo quando as caixas viajam juntas.
--
-- A API do ML aceita: "a emissao se baseia no numero de UMA OU MAIS vendas".
-- Mandamos uma.
--
-- Consequencia na esteira, que e o detalhe que se erra aqui: um pacote com
-- tres pedidos so vai para Faturado quando as TRES notas estiverem
-- autorizadas. Uma caixa com duas notas boas e uma rejeitada nao pode seguir.

alter table public.notas_fiscais
  add column if not exists pedido_id uuid references public.pedidos (id) on delete set null;

create index if not exists notas_fiscais_pedido_idx on public.notas_fiscais (pedido_id);

comment on column public.notas_fiscais.pedido_id is
  'A nota e deste pedido. Um pedido, uma nota — e a chave de idempotencia garante.';

drop function if exists public.chave_da_nota(uuid);

create or replace function public.chave_da_nota(p_pedido_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.conta_id::text || ':' || p.ref_externa
  from public.pedidos p
  where p.id = p_pedido_id;
$$;

comment on function public.chave_da_nota is
  'Conta + referencia do pedido. Pedir duas vezes o mesmo pedido nao gera duas notas.';

drop function if exists public.solicitar_nota(uuid, boolean);

create or replace function public.solicitar_nota(
  p_pedido_id uuid,
  p_manual boolean default false
)
returns table (ok boolean, motivo text, nota_id uuid, chave text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta uuid;
  v_pacote uuid;
  v_ref text;
  v_auto boolean;
  v_pausada timestamptz;
  v_emissora uuid;
  v_chave text;
  v_nota public.notas_fiscais%rowtype;
  v_id uuid;
begin
  select p.conta_id, p.ref_externa, pa.id, c.emissao_automatica,
         c.emissao_pausada_em, c.empresa_emissora_id
    into v_conta, v_ref, v_pacote, v_auto, v_pausada, v_emissora
  from public.pedidos p
  join public.contas c on c.id = p.conta_id
  left join public.pacotes pa on pa.envio_id = p.envio_id
  where p.id = p_pedido_id;

  if not found then
    return query select false, 'pedido_nao_encontrado', null::uuid, null::text;
    return;
  end if;

  -- Manual passa por cima do desligado e da pausa: e alguem decidindo, com
  -- nome, depois de olhar. O automatico nao.
  if not p_manual then
    if not v_auto then
      return query select false, 'emissao_desligada', null::uuid, null::text;
      return;
    end if;

    if v_pausada is not null then
      return query select false, 'emissao_pausada', null::uuid, null::text;
      return;
    end if;
  end if;

  if v_emissora is null then
    if v_pacote is not null then
      insert into public.bloqueios (pacote_id, tipo, causa)
      select v_pacote, 'faturador_nao_configurado',
             'A conta nao tem empresa emissora definida'
      where not exists (
        select 1 from public.bloqueios b
        where b.pacote_id = v_pacote
          and b.tipo = 'faturador_nao_configurado'
          and b.resolvido_em is null
      );

      update public.pacotes set etapa = 'aberto'
       where id = v_pacote and etapa = 'faturado';
    end if;

    return query select false, 'faturador_nao_configurado', null::uuid, null::text;
    return;
  end if;

  v_chave := public.chave_da_nota(p_pedido_id);

  select * into v_nota from public.notas_fiscais nf
  where nf.chave_idempotencia = v_chave;

  if found then
    if v_nota.situacao in ('solicitada', 'autorizada') then
      return query select true, 'ja_existe', v_nota.id, v_chave;
      return;
    end if;

    update public.notas_fiscais nf
       set situacao = 'solicitada',
           tentativas = nf.tentativas + 1,
           erro_codigo = null,
           erro_mensagem = null,
           campo_a_corrigir = null,
           solicitada_em = now()
     where nf.id = v_nota.id;

    return query select true, 'reenviada', v_nota.id, v_chave;
    return;
  end if;

  insert into public.notas_fiscais
    (conta_id, pedido_id, pacote_id, chave_idempotencia, pedidos_ref,
     situacao, tentativas)
  values (v_conta, p_pedido_id, v_pacote, v_chave, array[v_ref], 'solicitada', 1)
  returning id into v_id;

  return query select true, 'ok', v_id, v_chave;
end;
$$;

comment on function public.solicitar_nota is
  'Cria (ou reusa) a nota de UM pedido. Pedido com varios produtos vira uma nota com varios itens; pedidos diferentes viram notas diferentes.';

/**
 * Um pacote so sai de Aberto quando TODOS os pedidos dele tem nota
 * autorizada. Uma caixa com duas notas boas e uma rejeitada nao segue — e a
 * caixa inteira que nao pode viajar, nao dois tercos dela.
 */
create or replace function public.reavaliar_pacote(p_pacote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.bloqueios b
    where b.pacote_id = p_pacote_id and b.resolvido_em is null
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.pacotes pa
    join public.pedidos p on p.envio_id = pa.envio_id
    left join public.notas_fiscais nf
      on nf.pedido_id = p.id and nf.situacao = 'autorizada'
    where pa.id = p_pacote_id and nf.id is null
  ) then
    return;
  end if;

  update public.pacotes set etapa = 'faturado'
   where id = p_pacote_id and etapa = 'aberto';
end;
$$;

comment on function public.reavaliar_pacote is
  'Tira o pacote de Aberto quando nao ha bloqueio e TODOS os pedidos dele tem nota autorizada.';

revoke all on function public.chave_da_nota(uuid) from public;
revoke all on function public.solicitar_nota(uuid, boolean) from public;
revoke all on function public.reavaliar_pacote(uuid) from public;
grant execute on function public.chave_da_nota(uuid) to authenticated;
grant execute on function public.solicitar_nota(uuid, boolean) to authenticated;
grant execute on function public.reavaliar_pacote(uuid) to authenticated;
