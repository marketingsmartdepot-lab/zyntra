-- Quais pedidos estao parados por uma causa.
--
-- A aba Aberto agrupa por causa e mostra so o total. Para reprocessar e
-- preciso descer ate os pedidos, porque a nota e por pedido — nao por pacote e
-- nao por causa.
--
-- So faz sentido reprocessar causa FISCAL. `sku_nao_mapeado` destrava sozinho
-- quando alguem mapeia; `sem_estoque` e `pedido_alterado` nao se resolvem
-- pedindo nota de novo. Por isso o filtro esta aqui dentro e nao na tela: a
-- regra e do dominio, nao do botao.

create or replace function public.pedidos_da_causa(
  p_tipo text,
  p_codigo text default null
)
returns table (pedido_id uuid, pacote_id uuid, ref_externa text, conta text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    p.id,
    pa.id,
    p.ref_externa,
    ct.apelido
  from public.bloqueios b
  join public.pacotes pa on pa.id = b.pacote_id
  join public.pedidos p on p.envio_id = pa.envio_id
  join public.contas ct on ct.id = pa.conta_id
  where b.resolvido_em is null
    and pa.etapa = 'aberto'
    and b.tipo::text = p_tipo
    and (p_codigo is null or b.codigo is not distinct from p_codigo)
    and p_tipo in ('rejeicao_fiscal', 'sem_nota', 'faturador_nao_configurado')

  union

  -- A rejeicao tambem chega pela nota, e nem sempre abriu bloqueio ainda.
  select distinct
    p.id,
    pa.id,
    p.ref_externa,
    ct.apelido
  from public.notas_fiscais nf
  join public.pedidos p on p.id = nf.pedido_id
  join public.pacotes pa on pa.envio_id = p.envio_id
  join public.contas ct on ct.id = pa.conta_id
  where nf.situacao = 'rejeitada'
    and pa.etapa = 'aberto'
    and p_tipo = 'rejeicao_fiscal'
    and (p_codigo is null or nf.erro_codigo is not distinct from p_codigo);
$$;

comment on function public.pedidos_da_causa is
  'Os pedidos parados por uma causa fiscal. So causa fiscal: SKU nao mapeado destrava sozinho e falta de estoque nao se resolve pedindo nota.';

revoke all on function public.pedidos_da_causa(text, text) from public;
grant execute on function public.pedidos_da_causa(text, text) to authenticated;
