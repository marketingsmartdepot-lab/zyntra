-- A lista de separação ganha um destino, escolhido na hora de gerar.
--
-- PAPEL: nada muda. Um clique, a folha sai, os pedidos vão direto para
-- Conferir. É a decisão original dela, e continua valendo inteira.
--
-- COLETOR: a lista nasce em separação. Os pacotes FICAM em Separar e travados
-- — ninguém gera outra lista com eles — e só andam para Conferir quando o
-- colaborador fechar a lista no coletor.
--
-- O cadeado já existe: `listas_pacotes.ativa`, com índice único parcial por
-- pacote. Hoje criar_lista solta o cadeado na última linha. No modo coletor
-- ele fica preso até o fechamento. Encaixa sem inventar estrutura.

alter table public.listas_separacao
  add column if not exists modo text not null default 'papel';

alter table public.listas_separacao
  drop constraint if exists listas_separacao_modo_check;
alter table public.listas_separacao
  add constraint listas_separacao_modo_check check (modo in ('papel', 'coletor'));

comment on column public.listas_separacao.modo is
  'papel = a folha sai e os pedidos vão direto para Conferir. coletor = fica '
  'em separação até o colaborador fechar a lista no aparelho.';

alter table public.listas_separacao
  drop constraint if exists listas_separacao_situacao_check;
alter table public.listas_separacao
  add constraint listas_separacao_situacao_check
  check (situacao in ('emitida', 'em_separacao', 'concluida', 'cancelada'));

/**
 * Quanto de cada produto já foi separado nesta lista.
 *
 * Precisa ser TABELA: `listas_itens` é uma view, calculada a partir dos
 * pacotes, e view não guarda progresso. Sem isto o coletor não teria onde
 * anotar que duas das três unidades já estão no carrinho.
 */
create table if not exists public.separacao_itens (
  lista_id uuid not null references public.listas_separacao(id) on delete cascade,
  sku_id uuid not null references public.skus(id) on delete cascade,
  quantidade integer not null default 0 check (quantidade >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (lista_id, sku_id)
);

alter table public.separacao_itens enable row level security;

drop policy if exists "equipe le separacao_itens" on public.separacao_itens;
create policy "equipe le separacao_itens" on public.separacao_itens
  for select using (public.e_da_equipe());

-- A escrita é só pelas funções: bipar tem regra (não pertence, ambíguo,
-- excedente) e deixar o aparelho escrever direto jogaria a regra fora.
revoke all on public.separacao_itens from anon, authenticated;
grant select on public.separacao_itens to authenticated;

/**
 * O que o coletor mostra: cada produto da lista com o esperado e o separado.
 *
 * Sai da view dos itens, então herda a explosão de kit — quem separa pega o
 * componente, não o kit.
 */
create or replace view public.separacao_progresso
with (security_invoker = true)
as
  select
    li.lista_id,
    li.sku_id,
    li.codigo,
    li.descricao,
    li.foto_url,
    li.codigo_barras,
    li.unidades                                   as esperado,
    coalesce(si.quantidade, 0)                    as separado,
    greatest(li.unidades - coalesce(si.quantidade, 0), 0) as faltam,
    (coalesce(si.quantidade, 0) >= li.unidades)   as completo,
    li.pacotes
  from public.listas_itens li
  left join public.separacao_itens si
         on si.lista_id = li.lista_id and si.sku_id = li.sku_id;

grant select on public.separacao_progresso to authenticated;
