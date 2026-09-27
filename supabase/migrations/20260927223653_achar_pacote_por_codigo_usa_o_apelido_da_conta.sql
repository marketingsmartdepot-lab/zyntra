/**
 * Qual pedido em Conferir tem este produto.
 *
 * É o "modo bipagem": a pessoa não escolhe o pedido na lista, ela bipa o que
 * está na caixa e o sistema acha. Numa bancada com as mãos ocupadas, procurar
 * o pedido na tela é o passo que sobra.
 *
 * Devolve TODOS os candidatos, não o primeiro. O mesmo produto pode estar em
 * três pedidos da fila, e escolher um sozinho seria abrir a caixa errada — a
 * tela mostra os três e a pessoa aponta.
 *
 * Procura por código de barras e, se não achar, pelo código do SKU. Aqui isso
 * é só navegação: quem bipa ainda vai ter de provar cada unidade dentro da
 * conferência, onde a permissão de bipar por SKU continua valendo.
 *
 * (Esta versão corrige a anterior: a conta não tem coluna `nome`, o que
 * aparece na tela é o `apelido`.)
 */
create or replace function public.achar_pacote_por_codigo(p_codigo text)
returns table(
  pacote_id uuid,
  pedido text,
  cliente text,
  conta text,
  unidades integer,
  ja_aberta boolean,
  casou_por text
)
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_codigo text := btrim(coalesce(p_codigo, ''));
  v_skus uuid[];
  v_casou text;
begin
  perform public.exige_perfil_ativo();

  if v_codigo = '' then
    return;
  end if;

  -- 1. código de barras: a prova forte.
  select array_agg(distinct cb.sku_id) into v_skus
  from public.sku_codigos_barras cb
  where cb.codigo = v_codigo;

  if v_skus is not null and cardinality(v_skus) > 0 then
    v_casou := 'codigo_barras';
  else
    -- 2. código do SKU, digitado.
    select array_agg(s.id) into v_skus
    from public.skus s
    where upper(btrim(s.codigo)) = upper(v_codigo);

    if v_skus is null or cardinality(v_skus) = 0 then
      return;
    end if;
    v_casou := 'codigo_sku';
  end if;

  return query
  select distinct on (pa.id)
    pa.id,
    pe.ref_externa,
    coalesce(pe.comprador, 'sem nome'),
    co.apelido,
    (select coalesce(sum(i.quantidade), 0)::integer
       from public.pedido_itens i where i.pedido_id = pe.id),
    exists (select 1 from public.conferencias c
             where c.pacote_id = pa.id and c.situacao = 'em_andamento'),
    v_casou
  from public.pacotes pa
  join public.pedidos pe on pe.envio_id = pa.envio_id
  join public.contas co on co.id = pe.conta_id
  join public.pedido_itens it on it.pedido_id = pe.id
  left join public.mapeamentos_anuncio m
         on m.conta_id = pe.conta_id
        and m.ref_anuncio = it.ref_anuncio
        and coalesce(m.ref_variacao, '') = coalesce(it.ref_variacao, '')
  left join public.skus si
         on upper(btrim(si.codigo)) = upper(btrim(coalesce(it.sku_informado, '')))
  where pa.etapa = 'conferir'
    and (m.sku_id = any(v_skus) or si.id = any(v_skus))
  order by pa.id, pe.ref_externa;
end;
$fn$;

revoke all on function public.achar_pacote_por_codigo(text) from public;
grant execute on function public.achar_pacote_por_codigo(text) to authenticated;
