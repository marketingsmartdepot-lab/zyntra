-- A lista de separação deixa de ser um processo e vira um documento.
--
-- Como era: gerar a lista prendia os pacotes em Separar, e alguém tinha que
-- voltar numa tela e clicar "concluir" para as caixas aparecerem na bancada.
-- Isso é software mandando na operação — no galpão ninguém anuncia num
-- computador que acabou o corredor.
--
-- Como fica: gerar a lista imprime o papel e manda os pedidos direto para
-- Conferir, no mesmo ato. A aba Lista de separação continua existindo, mas
-- como registro: quais pedidos entraram naquela lista, quem a gerou e quando.
-- É o que se consulta quando uma caixa some ou vem errada.

-- ------------------------------------------------------- situação nova

alter table public.listas_separacao
  drop constraint listas_separacao_situacao_check;

alter table public.listas_separacao
  add constraint listas_separacao_situacao_check
  check (situacao in ('emitida', 'cancelada'));

alter table public.listas_separacao
  alter column situacao set default 'emitida';

-- As listas que já existiam nasceram no modelo antigo. Nenhuma delas está
-- viva num corredor agora, então todas viram registro.
update public.listas_separacao
   set situacao = case when situacao = 'cancelada' then 'cancelada' else 'emitida' end;

comment on column public.listas_separacao.situacao is
  'A lista nasce emitida: o papel saiu e os pedidos ja foram para Conferir. Cancelada e o papel que se perdeu antes de sair.';

comment on column public.listas_separacao.iniciada_em is
  'Herdado do modelo antigo, quando a lista tinha inicio e fim. Hoje e sempre nulo.';

-- O gatilho que soltava os pacotes ao concluir não tem mais o que observar:
-- `criar_lista` já solta tudo no mesmo ato. Fica só o caso de cancelamento.
create or replace function public.sincronizar_lista_ativa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.situacao = 'cancelada' and old.situacao <> 'cancelada' then
    update public.listas_pacotes set ativa = false where lista_id = new.id;
  end if;
  return new;
end;
$$;

comment on column public.listas_pacotes.ativa is
  'Trava momentanea, viva so durante a criacao da lista, para o indice parcial impedir que dois cliques simultaneos ponham o mesmo pacote em duas listas. A linha em si e o registro permanente e nunca e apagada.';

-- ------------------------------------------------- criar = emitir e mover

drop function if exists public.criar_lista(uuid[]);
drop function if exists public.concluir_lista(uuid);

create or replace function public.criar_lista(
  p_pacote_ids uuid[],
  p_separador_id uuid default null
)
returns table (ok boolean, motivo text, lista uuid, adicionados integer, recusados integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lista uuid;
  v_add integer;
  v_pedidos integer := coalesce(array_length(p_pacote_ids, 1), 0);
begin
  if v_pedidos = 0 then
    return query select false, 'nenhum_pacote', null::uuid, 0, 0;
    return;
  end if;

  -- Trava as linhas antes de olhar a etapa. Sem isso, dois operadores
  -- clicando ao mesmo tempo leriam 'separar' os dois e gerariam duas listas
  -- com o mesmo pacote.
  perform 1 from public.pacotes
   where id = any(p_pacote_ids)
   for update;

  -- Só entra em lista quem está em Separar. Se um único pacote da seleção
  -- estiver fora, a lista inteira é recusada: clique errado não deve mover
  -- meia dúzia de caixas sem ninguém perceber.
  if exists (
    select 1 from unnest(p_pacote_ids) as x(id)
    left join public.pacotes pa on pa.id = x.id
    where pa.id is null or pa.etapa <> 'separar'
  ) then
    return query select false, 'pacote_fora_de_separar', null::uuid, 0, 0;
    return;
  end if;

  insert into public.listas_separacao (criada_por, separador_id, situacao)
  values (auth.uid(), p_separador_id, 'emitida')
  returning id into v_lista;

  insert into public.listas_pacotes (lista_id, pacote_id)
  select v_lista, x.id from unnest(p_pacote_ids) as x(id)
  on conflict (pacote_id) where ativa do nothing;

  get diagnostics v_add = row_count;

  if v_add = 0 then
    delete from public.listas_separacao where id = v_lista;
    return query select false, 'todos_ja_em_lista', null::uuid, 0, v_pedidos;
    return;
  end if;

  -- O ponto da mudança: gerar a lista É mandar para a bancada. O papel sai e
  -- as caixas já contam em Conferir, que é onde elas vão parar de fato.
  update public.pacotes pa
     set etapa = 'conferir'
   where pa.id in (
     select lp.pacote_id from public.listas_pacotes lp
      where lp.lista_id = v_lista
   );

  -- Solta a trava: o vínculo com a lista continua registrado, mas o pacote
  -- pode voltar para Separar e entrar numa lista nova se precisar.
  update public.listas_pacotes set ativa = false where lista_id = v_lista;

  return query select true, 'ok', v_lista, v_add, v_pedidos - v_add;
end;
$$;

comment on function public.criar_lista is
  'Emite a lista, guarda quem a gerou e manda os pedidos dela para Conferir no mesmo ato.';

-- --------------------------------------------------------------- views

-- As views contavam só o que estava `ativa`. Com a trava caindo logo após a
-- criação, isso faria toda lista aparecer vazia — justamente o registro que
-- se quer consultar depois. O vínculo é permanente; o filtro sai.

drop view if exists public.listas_resumo;

create or replace view public.listas_resumo
with (security_invoker = true)
as
select
  l.id,
  l.codigo,
  l.situacao,
  l.criada_em,
  l.iniciada_em,
  l.concluida_em,
  o.nome as separador,
  p.nome as gerada_por,
  count(lp.pacote_id)::integer as pacotes,
  coalesce(sum(pa.unidades_esperadas), 0)::integer as unidades,
  count(distinct pa.conta_id)::integer as contas
from public.listas_separacao l
left join public.operadores o on o.id = l.separador_id
left join public.perfis p on p.id = l.criada_por
left join public.listas_pacotes lp on lp.lista_id = l.id
left join public.pacotes pa on pa.id = lp.pacote_id
group by l.id, l.codigo, l.situacao, l.criada_em, l.iniciada_em,
         l.concluida_em, o.nome, p.nome;

comment on view public.listas_resumo is
  'As listas com pacotes, unidades e contas ja contados, mais quem gerou.';

create or replace view public.listas_itens
with (security_invoker = true)
as
select
  lp.lista_id,
  e.sku_id,
  s.codigo,
  s.descricao,
  s.foto_url,
  cb.codigo as codigo_barras,
  sum(e.quantidade)::integer as unidades,
  count(distinct pa.id)::integer as pacotes
from public.listas_pacotes lp
join public.pacotes pa on pa.id = lp.pacote_id
join public.pedidos p on p.envio_id = pa.envio_id
join public.pedido_itens i on i.pedido_id = p.id
join public.mapeamentos_anuncio m
  on m.conta_id = p.conta_id
 and m.ref_anuncio = i.ref_anuncio
 and coalesce(m.ref_variacao, '') = coalesce(i.ref_variacao, '')
cross join lateral public.explodir_sku(m.sku_id, i.quantidade) e
join public.skus s on s.id = e.sku_id
left join lateral (
  select c.codigo from public.sku_codigos_barras c
  where c.sku_id = e.sku_id and c.principal
  limit 1
) cb on true
group by lp.lista_id, e.sku_id, s.codigo, s.descricao, s.foto_url, cb.codigo;

comment on view public.listas_itens is
  'A lista do corredor, consolidada por SKU e com o kit ja explodido.';

-- Quais pedidos entraram naquela lista. É o registro que se abre quando uma
-- caixa some: o código do envio, a conta, e em que etapa ele está hoje.
create or replace view public.listas_pacotes_resumo
with (security_invoker = true)
as
select
  lp.lista_id,
  pa.id as pacote_id,
  en.ref_externa as codigo,
  pa.etapa::text as etapa,
  pa.unidades_esperadas as unidades,
  c.apelido as conta,
  ca.nome as canal
from public.listas_pacotes lp
join public.pacotes pa on pa.id = lp.pacote_id
join public.envios en on en.id = pa.envio_id
join public.contas c on c.id = pa.conta_id
join public.canais ca on ca.id = c.canal_id;

comment on view public.listas_pacotes_resumo is
  'Os pedidos de cada lista e onde cada um esta hoje. E o registro para quando uma caixa some.';

-- --------------------------------------------------------------- grants

revoke all on function public.criar_lista(uuid[], uuid) from public, anon;
grant execute on function public.criar_lista(uuid[], uuid) to authenticated;
