-- Quem drena a fila: o proprio banco, agendado.
--
-- Sem isto a fila enchia e ficava esperando alguem clicar. Agendamento tambem
-- recupera sozinho o que falhou — se o Bling cair uma hora, a baixa sai quando
-- ele voltar, sem ninguem olhar.
--
-- Roda no banco e nao numa Edge Function porque o token do Bling ja esta no
-- banco: nao precisa guardar chave de servico em lugar nenhum novo para uma
-- coisa chamar a outra.
--
-- O Bling registra UM movimento por produto, entao uma baixa de tres SKUs sao
-- tres chamadas. A linha do pedido continua sendo a ancora da idempotencia — o
-- indice unico por (pedido, tipo) — e ganha filhas, uma por SKU, com o proprio
-- unico por (baixa, sku). Nem o pedido nem a peca baixam duas vezes.

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.baixas_estoque
  add column if not exists tentar_apos timestamptz not null default now();

comment on column public.baixas_estoque.tentar_apos is
  'Espera crescente entre tentativas. Sem isto, Bling fora do ar viraria uma chamada por minuto para sempre.';

create table if not exists public.baixas_estoque_itens (
  id uuid primary key default gen_random_uuid(),
  baixa_id uuid not null references public.baixas_estoque (id) on delete cascade,
  sku_id uuid not null references public.skus (id) on delete restrict,
  erp_ref text,
  quantidade integer not null check (quantidade > 0),
  situacao text not null default 'pendente'
    check (situacao in ('pendente', 'enviando', 'enviada', 'erro')),
  request_id bigint,
  erro text,
  enviada_em timestamptz
);

create unique index if not exists baixas_itens_um_por_sku
  on public.baixas_estoque_itens (baixa_id, sku_id);

create index if not exists baixas_itens_aguardando
  on public.baixas_estoque_itens (request_id) where situacao = 'enviando';

comment on table public.baixas_estoque_itens is
  'Uma linha por SKU da baixa, porque o Bling registra um movimento por produto. O unico por (baixa, sku) impede a mesma peca sair duas vezes.';

alter table public.baixas_estoque_itens enable row level security;
create policy "equipe le itens da baixa" on public.baixas_estoque_itens
  for select to authenticated using (true);

/**
 * Materializa os itens de uma baixa.
 *
 * Feito na hora de enviar e nao ao enfileirar: se o mapeamento do anuncio for
 * corrigido entre a nota e o envio, a baixa sai certa. E SKU sem referencia no
 * Bling vira erro explicito em vez de sumir da conta.
 */
create or replace function public.materializar_itens_da_baixa(p_baixa_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido uuid;
  v_n integer;
begin
  select pedido_id into v_pedido from public.baixas_estoque where id = p_baixa_id;

  insert into public.baixas_estoque_itens (baixa_id, sku_id, erp_ref, quantidade)
  select p_baixa_id, i.sku_id, i.erp_ref, i.quantidade
  from public.itens_para_baixa(v_pedido) i
  on conflict (baixa_id, sku_id) do nothing;

  select count(*) into v_n
  from public.baixas_estoque_itens where baixa_id = p_baixa_id;

  return v_n;
end;
$$;

/**
 * Dispara o que esta vencido, e volta.
 *
 * `for update skip locked` para duas execucoes do agendador nunca pegarem a
 * mesma linha. O disparo e assincrono: a resposta e recolhida depois, pelo
 * outro trabalho.
 */
create or replace function public.drenar_baixas(p_limite integer default 20)
returns table (baixas integer, chamadas integer, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ativo boolean;
  v_token text;
  v_baixa record;
  v_item record;
  v_n_baixas integer := 0;
  v_n_chamadas integer := 0;
  v_req bigint;
begin
  select c.ativo into v_ativo from public.erp_config c where c.id;

  if not coalesce(v_ativo, false) then
    return query select 0, 0, 'envio_desligado';
    return;
  end if;

  select ce.access_token into v_token from privado.credenciais_erp ce where ce.id;

  if coalesce(v_token, '') = '' then
    return query select 0, 0, 'sem_credencial';
    return;
  end if;

  for v_baixa in
    select b.id, b.tipo, b.deposito_ref, b.tentativas
    from public.baixas_estoque b
    where b.situacao = 'pendente'
      and b.tentar_apos <= now()
    order by b.criada_em
    limit greatest(p_limite, 1)
    for update skip locked
  loop
    if coalesce(v_baixa.deposito_ref, '') = '' then
      update public.baixas_estoque
         set situacao = 'erro',
             erro = 'Nenhum deposito configurado quando esta baixa foi enfileirada.',
             tentativas = v_baixa.tentativas + 1
       where id = v_baixa.id;
      continue;
    end if;

    perform public.materializar_itens_da_baixa(v_baixa.id);

    -- SKU sem referencia no Bling nao tem como baixar. Dizer qual, em vez de
    -- sumir com a peca da conta.
    if exists (
      select 1 from public.baixas_estoque_itens i
      where i.baixa_id = v_baixa.id and coalesce(i.erp_ref, '') = ''
    ) then
      update public.baixas_estoque
         set situacao = 'erro',
             tentativas = v_baixa.tentativas + 1,
             erro = 'SKU sem referencia no Bling: ' || (
               select string_agg(s.codigo, ', ')
               from public.baixas_estoque_itens i
               join public.skus s on s.id = i.sku_id
               where i.baixa_id = v_baixa.id and coalesce(i.erp_ref, '') = ''
             )
       where id = v_baixa.id;
      continue;
    end if;

    v_n_baixas := v_n_baixas + 1;

    for v_item in
      select i.id, i.erp_ref, i.quantidade
      from public.baixas_estoque_itens i
      where i.baixa_id = v_baixa.id and i.situacao in ('pendente', 'erro')
    loop
      select net.http_post(
        url := 'https://api.bling.com.br/Api/v3/estoques',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_token,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'produto', jsonb_build_object('id', v_item.erp_ref),
          'deposito', jsonb_build_object('id', v_baixa.deposito_ref),
          -- 'S' tira da prateleira, 'E' devolve.
          'operacao', case when v_baixa.tipo = 'estorno' then 'E' else 'S' end,
          'quantidade', v_item.quantidade
        ),
        timeout_milliseconds := 15000
      ) into v_req;

      update public.baixas_estoque_itens
         set situacao = 'enviando', request_id = v_req, erro = null
       where id = v_item.id;

      v_n_chamadas := v_n_chamadas + 1;
    end loop;

    update public.baixas_estoque
       set tentativas = v_baixa.tentativas + 1,
           -- Espera crescente, teto de uma hora.
           tentar_apos = now() + least(
             make_interval(mins => power(3, v_baixa.tentativas + 1)::integer),
             interval '1 hour'
           )
     where id = v_baixa.id;
  end loop;

  return query select v_n_baixas, v_n_chamadas, 'ok'::text;
end;
$$;

comment on function public.drenar_baixas is
  'Dispara as baixas vencidas no Bling. Assincrono: a resposta e recolhida depois.';

/**
 * Recolhe o que o Bling respondeu.
 *
 * A baixa so vira `enviada` quando TODAS as pecas dela sairam. Meia baixa
 * enviada e pior do que nenhuma: o estoque fica errado e o sistema acha que
 * esta certo.
 */
create or replace function public.coletar_respostas_baixa()
returns table (resolvidos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  update public.baixas_estoque_itens i
     set situacao = case when r.status_code between 200 and 299 then 'enviada' else 'erro' end,
         enviada_em = case when r.status_code between 200 and 299 then now() else null end,
         erro = case
           when r.status_code between 200 and 299 then null
           else 'Bling respondeu ' || r.status_code || ': ' || left(coalesce(r.content, ''), 300)
         end
    from net._http_response r
   where r.id = i.request_id
     and i.situacao = 'enviando';

  get diagnostics v_n = row_count;

  update public.baixas_estoque b
     set situacao = 'enviada', enviada_em = now(), erro = null
   where b.situacao = 'pendente'
     and exists (select 1 from public.baixas_estoque_itens i where i.baixa_id = b.id)
     and not exists (
       select 1 from public.baixas_estoque_itens i
       where i.baixa_id = b.id and i.situacao <> 'enviada'
     );

  update public.baixas_estoque b
     set situacao = 'erro',
         erro = (
           select string_agg(distinct i.erro, ' | ')
           from public.baixas_estoque_itens i
           where i.baixa_id = b.id and i.situacao = 'erro'
         )
   where b.situacao = 'pendente'
     and exists (
       select 1 from public.baixas_estoque_itens i
       where i.baixa_id = b.id and i.situacao = 'erro'
     );

  return query select v_n;
end;
$$;

comment on function public.coletar_respostas_baixa is
  'Aplica o que o Bling respondeu. A baixa so fica enviada quando todas as pecas sairam.';

revoke execute on function public.drenar_baixas(integer) from public, anon, authenticated;
revoke execute on function public.coletar_respostas_baixa() from public, anon, authenticated;
revoke execute on function public.materializar_itens_da_baixa(uuid) from public, anon, authenticated;

-- A cada dois minutos dispara, a cada minuto recolhe. Nao precisa ser mais
-- rapido: a peca ja saiu do disponivel no momento em que a nota autorizou.
select cron.schedule('zyntra-drena-baixas', '*/2 * * * *',
  $cron$ select public.drenar_baixas(20) $cron$);

select cron.schedule('zyntra-coleta-baixas', '* * * * *',
  $cron$ select public.coletar_respostas_baixa() $cron$);
