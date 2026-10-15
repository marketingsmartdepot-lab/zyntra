-- O gatilho automático da emissão. Até agora só existia o caminho manual (o
-- botão "Pedir a nota de novo" na aba Aberto, que já chama a função `nota`).
--
-- Por que o cron fala com a MESMA Edge Function em vez de uma rota nova no
-- app: a rota /api/ml/etiquetas existe porque o ML entrega o ZPL dentro de um
-- ZIP e o banco não descompacta — ela é a exceção, não o padrão. A nota não
-- tem ZIP. Duplicar a emissão numa rota nova seria manter dois caminhos
-- capazes de emitir nota irreversível, livres para divergir. Um lugar emite.
--
-- A função `nota` passa a aceitar o segredo interno além do login de usuário,
-- e só o login pode `manual: true` — forçar por cima do desligado ou da pausa
-- é decisão de gente.

insert into privado.config (chave, valor)
values ('functions_url', 'https://jhgpqllkeqqeuqxxzzup.supabase.co/functions/v1')
on conflict (chave) do update set valor = excluded.valor;

/**
 * Pede a nota dos pedidos que ainda não têm nenhuma.
 *
 * As travas, e por que cada uma existe:
 *
 * - `emissao_automatica` por conta, `emissao_pausada_em` nulo, empresa
 *   emissora amarrada e faturador `ativo`. Estas quatro são o interruptor:
 *   enquanto qualquer uma estiver faltando, este cron roda e não pede nada.
 *   É de propósito — a infraestrutura fica pronta com a emissão desligada.
 *
 * - **Nenhuma linha de nota para o pedido.** A mais importante. Nota em
 *   `solicitada` significa "pedimos e não sabemos a resposta", e o ML pode ter
 *   emitido do outro lado. Repetir isso automaticamente seria o jeito mais
 *   rápido de emitir duas notas do mesmo pedido, e o ML não cancela por API.
 *   Quem resolve `solicitada` é a varredura de notas (que agora cura a linha,
 *   porque a chave de idempotência passou a casar) ou uma pessoa olhando.
 *
 * - Pedido pago e não cancelado. Emitir nota de pedido cancelado é criar
 *   trabalho fiscal do nada.
 *
 * - Sem bloqueio aberto que a nota não resolva. `faturador_nao_configurado` e
 *   `sem_nota` entram, porque são exatamente o que emitir resolve; os outros
 *   (SKU não mapeado, pedido alterado) não.
 */
create or replace function public.pedir_notas_ml(p_limite integer default 20)
returns table (pedidas integer, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_segredo text;
  v_p record;
  v_req bigint;
  n integer := 0;
begin
  select c.valor into v_url from privado.config c where c.chave = 'functions_url';
  select c.valor into v_segredo from privado.config c where c.chave = 'segredo_interno';

  if coalesce(v_url, '') = '' or coalesce(v_segredo, '') = '' then
    return query select 0, 'sem_configuracao';
    return;
  end if;

  for v_p in
    select p.id
    from public.pedidos p
    join public.contas ct on ct.id = p.conta_id
    join public.canais ca on ca.id = ct.canal_id
    join public.empresas em on em.id = ct.empresa_emissora_id
    join public.pacotes pa on pa.envio_id = p.envio_id
    where ca.slug = 'mercado_livre'
      and ct.situacao = 'conectada'
      and ct.emissao_automatica
      and ct.emissao_pausada_em is null
      and em.faturador_situacao = 'ativo'
      and p.pago_em is not null
      and p.cancelado_em is null
      and pa.etapa in ('aberto', 'faturado')
      and not exists (
        select 1 from public.notas_fiscais nf where nf.pedido_id = p.id
      )
      and not exists (
        select 1 from public.bloqueios b
        where b.pacote_id = pa.id
          and b.resolvido_em is null
          and b.tipo not in ('faturador_nao_configurado', 'sem_nota')
      )
    order by p.pago_em
    limit greatest(coalesce(p_limite, 20), 1)
  loop
    select net.http_post(
      url := v_url || '/nota',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-zyntra-segredo', v_segredo
      ),
      body := jsonb_build_object('pedido_id', v_p.id),
      timeout_milliseconds := 25000
    ) into v_req;

    n := n + 1;
  end loop;

  return query select n, 'ok';
end;
$$;

comment on function public.pedir_notas_ml is
  'Pede a nota dos pedidos sem nenhuma linha de nota, em contas com emissao '
  'ligada e faturador ativo. Nunca repete pedido de nota em `solicitada`.';

/**
 * Dá rosto à nota que foi pedida e nunca respondeu.
 *
 * Sem isto o estado seria silencioso: nota `solicitada`, pacote em Faturado,
 * nenhum bloqueio — e `aberto_por_causa` só olha `rejeitada`. Um pedido que o
 * ML talvez tenha faturado, invisível.
 *
 * Abre `sem_nota` e manda o pacote para Aberto, onde a aba já sabe agrupar por
 * causa. O texto diz para conferir o painel do ML ANTES de pedir de novo,
 * porque pedir de novo pode emitir a segunda nota do mesmo pedido.
 *
 * A espera é generosa de propósito: a varredura de notas roda de cinco em
 * cinco minutos e cura a linha sozinha quando o ML responde. Só o que
 * sobrevive a isso é exceção de verdade.
 */
create or replace function public.marcar_notas_sem_resposta(p_minutos integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.bloqueios (pacote_id, tipo, causa, detalhe)
  select nf.pacote_id, 'sem_nota',
         'A nota foi pedida ao Mercado Livre e a resposta nao voltou',
         'Confira no painel do ML se ela foi emitida ANTES de pedir de novo: '
         'pedir de novo pode emitir uma segunda nota do mesmo pedido, e o ML '
         'nao cancela por API.'
  from public.notas_fiscais nf
  where nf.situacao = 'solicitada'
    and nf.pacote_id is not null
    and coalesce(nf.solicitada_em, nf.atualizado_em) < now() - make_interval(mins => greatest(coalesce(p_minutos, 30), 1))
    and not exists (
      select 1 from public.bloqueios b
      where b.pacote_id = nf.pacote_id
        and b.tipo = 'sem_nota'
        and b.resolvido_em is null
    );

  get diagnostics v_n = row_count;

  update public.pacotes pa
     set etapa = 'aberto', etapa_anterior = pa.etapa, etapa_desde = now(),
         atualizado_em = now()
   from public.notas_fiscais nf
  where nf.pacote_id = pa.id
    and nf.situacao = 'solicitada'
    and pa.etapa = 'faturado'
    and exists (
      select 1 from public.bloqueios b
      where b.pacote_id = pa.id and b.tipo = 'sem_nota' and b.resolvido_em is null
    );

  return v_n;
end;
$$;

comment on function public.marcar_notas_sem_resposta is
  'Transforma nota presa em `solicitada` em causa visivel na aba Aberto, para '
  'que um pedido possivelmente faturado no ML nao fique invisivel.';

revoke all on function public.pedir_notas_ml(integer) from public, anon, authenticated;
revoke all on function public.marcar_notas_sem_resposta(integer) from public, anon, authenticated;
