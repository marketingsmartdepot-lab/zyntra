-- Mapear o anuncio destrava os pedidos parados por ele, sozinho.
--
-- Este e o caso em que botao de "reprocessar" seria um defeito: a causa foi
-- resolvida DENTRO do sistema, entao o sistema sabe. Se alguem mapeia o SKU e
-- trinta pedidos continuam parados esperando um clique, o sistema esta fazendo
-- a pessoa trabalhar duas vezes pelo mesmo problema.
--
-- So destrava quem ficou COMPLETO. Um pacote com tres itens em que so um foi
-- mapeado continua parado — e continua certo que esteja.

create or replace function public.destravar_por_mapeamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pacote uuid;
begin
  for v_pacote in
    select distinct pa.id
    from public.bloqueios b
    join public.pacotes pa on pa.id = b.pacote_id
    join public.pedidos p on p.envio_id = pa.envio_id
    join public.pedido_itens i on i.pedido_id = p.id
    where b.tipo = 'sku_nao_mapeado'
      and b.resolvido_em is null
      and p.conta_id = new.conta_id
      and i.ref_anuncio = new.ref_anuncio
      and coalesce(i.ref_variacao, '') = coalesce(new.ref_variacao, '')
  loop
    -- Todo item daquele pacote precisa ter mapeamento agora. Destravar pela
    -- metade jogaria o pacote no corredor sem saber o que separar.
    if not exists (
      select 1
      from public.pacotes pa
      join public.pedidos p on p.envio_id = pa.envio_id
      join public.pedido_itens i on i.pedido_id = p.id
      left join public.mapeamentos_anuncio m
        on m.conta_id = p.conta_id
       and m.ref_anuncio = i.ref_anuncio
       and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
      where pa.id = v_pacote and m.id is null
    ) then
      update public.bloqueios
         set resolvido_em = now()
       where pacote_id = v_pacote
         and tipo = 'sku_nao_mapeado'
         and resolvido_em is null;

      perform public.reavaliar_pacote(v_pacote);
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists mapeamento_destrava on public.mapeamentos_anuncio;

create trigger mapeamento_destrava
  after insert or update of sku_id on public.mapeamentos_anuncio
  for each row execute function public.destravar_por_mapeamento();

comment on function public.destravar_por_mapeamento is
  'Mapear o anuncio resolve o bloqueio dos pacotes que ficaram completos. Causa resolvida dentro do sistema nao precisa de clique.';
