-- A aba Aberto conta pacotes, mas mostra BLOQUEIOS agrupados por causa. Os
-- pedidos entravam sem bloqueio nenhum: o contador dizia 7 e a tela dizia
-- "Nada parado". Um pacote parado e invisível é pior do que um pacote parado.
--
-- Faltava também quem FECHA o bloqueio. `reavaliar_pacote` não avança enquanto
-- houver bloqueio aberto, e ninguém os fechava — o pedido ficaria preso mesmo
-- depois de a nota sair.
--
-- Esta função faz as duas coisas e chama a reavaliação no fim, para o pacote
-- andar no mesmo instante em que deixa de estar parado.

create or replace function public.diagnosticar_pacote(p_pacote_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_falta_nota boolean;
  v_tipo public.bloqueio_tipo;
  v_causa text;
  v_detalhe text;
  v_conta record;
begin
  select exists (
    select 1
    from public.pacotes pa
    join public.pedidos p on p.envio_id = pa.envio_id
    left join public.notas_fiscais nf
      on nf.pedido_id = p.id and nf.situacao = 'autorizada'
    where pa.id = p_pacote_id and nf.id is null
  ) into v_falta_nota;

  if not v_falta_nota then
    update public.bloqueios b
       set resolvido_em = now()
     where b.pacote_id = p_pacote_id
       and b.resolvido_em is null
       and b.tipo in ('sem_nota', 'faturador_nao_configurado');

    perform public.reavaliar_pacote(p_pacote_id);
    return;
  end if;

  select ct.apelido,
         ct.empresa_emissora_id,
         em.nome_curto,
         coalesce(em.faturador_situacao, 'nao_configurado') as faturador
    into v_conta
  from public.pacotes pa
  join public.contas ct on ct.id = pa.conta_id
  left join public.empresas em on em.id = ct.empresa_emissora_id
  where pa.id = p_pacote_id;

  -- A causa é o que a pessoa tem de consertar, e consertar uma vez libera
  -- todos os pedidos daquela conta. Por isso o texto é da CONFIGURAÇÃO, não
  -- do pedido.
  if v_conta.empresa_emissora_id is null or v_conta.faturador <> 'ativo' then
    v_tipo := 'faturador_nao_configurado';
    v_causa := 'Faturador do Mercado Livre não está ativo na conta';
    v_detalhe := case
      when v_conta.empresa_emissora_id is null
        then 'A conta ' || v_conta.apelido || ' ainda não tem empresa emissora definida.'
      else 'O Faturador da empresa ' || coalesce(v_conta.nome_curto, '?')
           || ' está como "' || v_conta.faturador || '".'
    end;
  else
    v_tipo := 'sem_nota';
    v_causa := 'Aguardando a nota do Faturador do Mercado Livre';
    v_detalhe := 'A emissão foi pedida e a autorização ainda não voltou.';
  end if;

  update public.bloqueios b
     set resolvido_em = now()
   where b.pacote_id = p_pacote_id
     and b.resolvido_em is null
     and b.tipo <> v_tipo
     and b.tipo in ('sem_nota', 'faturador_nao_configurado');

  if not exists (
    select 1 from public.bloqueios b
    where b.pacote_id = p_pacote_id and b.tipo = v_tipo and b.resolvido_em is null
  ) then
    insert into public.bloqueios (pacote_id, tipo, causa, detalhe)
    values (p_pacote_id, v_tipo, v_causa, v_detalhe);
  else
    update public.bloqueios b
       set causa = v_causa, detalhe = v_detalhe
     where b.pacote_id = p_pacote_id and b.tipo = v_tipo and b.resolvido_em is null;
  end if;
end;
$$;

revoke all on function public.diagnosticar_pacote(uuid) from public, anon, authenticated;
