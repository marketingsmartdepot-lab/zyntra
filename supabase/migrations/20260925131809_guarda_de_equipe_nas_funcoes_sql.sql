-- As cinco em linguagem SQL não têm onde encaixar um `perform`. Viram plpgsql
-- com o corpo intacto dentro de um `return query`, só para ganhar a guarda.
-- O painel é leitura de faturamento: sem guarda, qualquer login lia o quanto a
-- empresa vendeu, mesmo sem ser da equipe.

create or replace function public.encerrar_sessao_estacao(p_estacao_id uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform public.exige_perfil_ativo();

  update public.sessoes_estacao
     set encerrada_em = now()
   where estacao_id = p_estacao_id and encerrada_em is null;
end;
$function$;

create or replace function public.painel_resumo(p_dias integer default 30)
returns table(faturamento numeric, pedidos integer, unidades integer, ticket numeric,
              faturamento_antes numeric, pedidos_antes integer, ticket_antes numeric)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  perform public.exige_perfil_ativo();

  return query
  with limites as (
    select
      (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) - 1) as de,
      (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) * 2 - 1) as de_antes,
      (now() at time zone 'America/Sao_Paulo')::date - greatest(p_dias, 1) as ate_antes
  ),
  base as (
    select
      p.total,
      p.unidades,
      (p.pago_em at time zone 'America/Sao_Paulo')::date as dia
    from public.pedidos p, limites l
    where p.cancelado_em is null
      and p.pago_em is not null
      and (p.pago_em at time zone 'America/Sao_Paulo')::date >= l.de_antes
  ),
  agora as (
    select
      coalesce(sum(b.total), 0)::numeric as faturamento,
      count(*)::integer as pedidos,
      coalesce(sum(b.unidades), 0)::integer as unidades
    from base b, limites l
    where b.dia >= l.de
  ),
  antes as (
    select
      coalesce(sum(b.total), 0)::numeric as faturamento,
      count(*)::integer as pedidos
    from base b, limites l
    where b.dia between l.de_antes and l.ate_antes
  )
  select
    a.faturamento,
    a.pedidos,
    a.unidades,
    case when a.pedidos > 0 then round(a.faturamento / a.pedidos, 2) else 0 end,
    n.faturamento,
    n.pedidos,
    case when n.pedidos > 0 then round(n.faturamento / n.pedidos, 2) else 0 end
  from agora a, antes n;
end;
$function$;

create or replace function public.painel_vendas_por_dia(p_dias integer default 30)
returns table(dia date, total numeric, pedidos integer, fim_de_semana boolean)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  perform public.exige_perfil_ativo();

  -- generate_series preenche o dia sem venda com zero. Sem isso o dia some e
  -- as barras ficam mais juntas onde não houve venda — o gráfico mentiria
  -- sobre o ritmo.
  return query
  select
    d.dia::date,
    coalesce(sum(p.total), 0)::numeric,
    count(p.id)::integer,
    extract(isodow from d.dia) >= 6
  from generate_series(
         (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) - 1),
         (now() at time zone 'America/Sao_Paulo')::date,
         interval '1 day'
       ) d(dia)
  left join public.pedidos p
    on (p.pago_em at time zone 'America/Sao_Paulo')::date = d.dia::date
   and p.cancelado_em is null
  group by d.dia
  order by d.dia;
end;
$function$;

create or replace function public.painel_produtos(p_dias integer default 30, p_limite integer default 6)
returns table(chave text, titulo text, codigo text, foto_url text,
              unidades integer, receita numeric, mapeado boolean)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  perform public.exige_perfil_ativo();

  return query
  select
    coalesce(s.id::text, 'anuncio:' || i.ref_anuncio) as chave,
    coalesce(s.descricao, max(i.titulo), i.ref_anuncio) as titulo,
    s.codigo,
    coalesce(max(i.foto_url), s.foto_url) as foto_url,
    sum(i.quantidade)::integer as unidades,
    coalesce(sum(i.quantidade * i.preco_unitario), 0)::numeric as receita,
    (s.id is not null) as mapeado
  from public.pedidos p
  join public.pedido_itens i on i.pedido_id = p.id
  left join public.mapeamentos_anuncio m
    on m.conta_id = p.conta_id
   and m.ref_anuncio = i.ref_anuncio
   and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
  left join public.skus s on s.id = m.sku_id
  where p.cancelado_em is null
    and p.pago_em is not null
    and (p.pago_em at time zone 'America/Sao_Paulo')::date
        >= (now() at time zone 'America/Sao_Paulo')::date - (greatest(p_dias, 1) - 1)
  group by s.id, s.codigo, s.descricao, s.foto_url, i.ref_anuncio
  order by sum(i.quantidade) desc
  limit greatest(p_limite, 1);
end;
$function$;

create or replace function public.pedidos_da_causa(p_tipo text, p_codigo text default null::text)
returns table(pedido_id uuid, pacote_id uuid, ref_externa text, conta text)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  perform public.exige_perfil_ativo();

  return query
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

  -- A rejeição também chega pela nota, e nem sempre abriu bloqueio ainda.
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
end;
$function$;

-- Esta tentativa estava errada e é desfeita na migração seguinte: estas duas
-- views PRECISAM de definer, e trocá-las para invoker quebrou as duas.
alter view public.operadores_situacao set (security_invoker = true);
alter view public.saude_das_conexoes set (security_invoker = true);
