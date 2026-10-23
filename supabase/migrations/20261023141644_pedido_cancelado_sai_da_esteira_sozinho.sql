-- Três pedidos cancelados no ML estavam ocupando a esteira — 2 em Aberto, 1
-- em Faturado. Ninguém vai separar, conferir nem despachar pedido cancelado,
-- então eles são fila de trabalho falsa: aparecem na contagem, aparecem na
-- seleção de lista, e alguém um dia pega um deles achando que é trabalho.
--
-- A decisão de 22/09 já previa isto: "existe uma sexta aba, fora da esteira,
-- para problema EXTERNO (cancelamento, endereço alterado, modalidade trocada
-- pelo ML)". Retidos é exatamente o lugar. O que faltava era alguém levar.
--
-- Agora é automático, e por dois caminhos:
--
--   o gatilho aqui       -> quando o pedido vira `cancelled`, na hora
--   reconciliar_envios_ml -> rede de segurança, para o que escapar
--
-- `reter_pacotes` não serve para isto: ela exige `pode('reter_pedido')`, que é
-- a trava certa para uma pessoa clicando numa tela, e errada para o sistema
-- reagindo a um fato do canal.

create or replace function public.reter_pacote_cancelado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pacote uuid;
  v_etapa text;
begin
  if coalesce(new.situacao_canal, '') <> 'cancelled'
     or coalesce(old.situacao_canal, '') = 'cancelled' then
    return new;
  end if;

  select pa.id, pa.etapa::text into v_pacote, v_etapa
  from public.pacotes pa where pa.envio_id = new.envio_id;

  -- Quem ja saiu do galpao nao volta para a esteira: a caixa esta na rua, e
  -- o cancelamento depois do envio e trabalho de devolucao, nao de retencao.
  if v_pacote is null or v_etapa in ('retido', 'enviado') then
    return new;
  end if;

  update public.pacotes set etapa = 'retido' where id = v_pacote;

  insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
  values (v_pacote, 'cancelado_no_canal', v_etapa, 'retido',
          'O Mercado Livre cancelou este pedido. Saiu da esteira para nao '
          || 'virar fila de trabalho falsa; volta sozinho se o cancelamento '
          || 'for desfeito.');

  return new;
end;
$$;

comment on function public.reter_pacote_cancelado is
  'Pedido cancelado no canal sai da esteira para Retidos. Quem ja esta em '
  'Enviado nao volta: a caixa esta na rua.';

create trigger pedido_cancelado_retem
  after update of situacao_canal on public.pedidos
  for each row execute function public.reter_pacote_cancelado();

-- ---------------------------------------------------------------------------
-- Os três que já estavam parados. O gatilho não os pega: a situação deles já
-- É `cancelled`, não vai mudar para `cancelled` de novo.
--
-- NOTA: este bloco não encontrou nada quando rodou, e por um motivo que valeu
-- aprender — o `cancelled` que eu tinha visto estava no ENVIO, não no pedido.
-- Os pedidos ainda constavam `paid` aqui, congelados pela janela de 2 horas.
-- Quem os levou para Retidos foi a reconciliação da migração seguinte, que
-- passou a perguntar também pelo pedido e disparou o gatilho acima.
do $$
declare v_r record; v_n integer := 0;
begin
  for v_r in
    select pa.id, pa.etapa::text as etapa
    from public.pacotes pa
    join public.pedidos p on p.envio_id = pa.envio_id
    where p.situacao_canal = 'cancelled'
      and pa.etapa in ('aberto','faturado','separar','conferir','pronto')
  loop
    update public.pacotes set etapa = 'retido' where id = v_r.id;

    insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe)
    values (v_r.id, 'cancelado_no_canal', v_r.etapa, 'retido',
            'O Mercado Livre cancelou este pedido. Saiu da esteira para nao '
            || 'virar fila de trabalho falsa.');

    v_n := v_n + 1;
  end loop;

  raise notice 'retidos agora: %', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- A rede de segurança diária. Foi falha CALADA que deixou a esteira mentindo
-- por um mês: o webhook pode cair, o ML pode desistir de reenviar, e nada
-- disso dá erro em lugar nenhum. Uma varredura por dia descobre em 24 horas,
-- não em 30 dias.
--
-- 04:20 UTC é 01:20 em Brasília: galpão fechado, ninguém esperando tela.
select cron.schedule('zyntra-reconciliar', '20 4 * * *',
                     $$ select public.reconciliar_envios_ml(300) $$);
