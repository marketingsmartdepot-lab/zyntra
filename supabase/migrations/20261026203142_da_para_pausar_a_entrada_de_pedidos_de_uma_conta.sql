-- Poder desligar a entrada de pedidos de UMA conta, sem desconectar a conta.
--
-- Pedido da Daniele, e o caso e real: conta que vai sair do ar, loja em ferias
-- coletivas, conta que ela quer parar de operar pelo ZYNTRA enquanto migra da
-- Lexos. Desconectar resolveria, mas perde o token e obriga a refazer o OAuth
-- depois — caro demais para uma pausa.
--
-- NAO reaproveitei `contas.entra_na_esteira`, que existe e seria o nome obvio.
-- Dois motivos:
--
--   1. Ela esta MORTA. O unico `entra_na_esteira` que alguem le e o da
--      MODALIDADE (e o que mantem o Full fora da esteira). Na conta, nenhuma
--      funcao a consulta — e por isso as duas contas da Daniele estao com ela
--      `false` e os pedidos caem assim mesmo.
--
--   2. O nome mente sobre o que ela faria. "Entra na esteira" sugere que o
--      pedido ENTRA no sistema e nao anda; o que ela quer e o pedido nao
--      entrar. Sao coisas diferentes na hora de procurar um pedido sumido.
--
-- Entao sigo o padrao que ja existe para pausar o faturamento
-- (`emissao_pausada_em` + `emissao_pausa_motivo`): uma data e um motivo. Data
-- em vez de booleano porque "desde quando" e a primeira pergunta quando
-- alguem nota que uma conta parou de trazer venda.

alter table public.contas
  add column if not exists importacao_pausada_em timestamptz,
  add column if not exists importacao_pausa_motivo text;

comment on column public.contas.importacao_pausada_em is
  'Desde quando esta conta parou de trazer pedidos. Nulo = trazendo. A conta '
  'segue conectada: o token continua valendo e nada precisa ser refeito.';

comment on column public.contas.importacao_pausa_motivo is
  'Por que a entrada de pedidos foi pausada. Aparece na tela ao lado da data.';

-- --------------------------------------------------------- a varredura
-- Conta pausada sai do laco logo na selecao: nao gasta token, nao gasta
-- chamada ao ML e nao aparece na contagem de contas varridas.
create or replace function public.varrer_pedidos_ml(
  p_janela interval default '02:00:00'::interval,
  p_quantos integer default 15,
  p_paginas integer default 6
)
returns table (contas integer, pedidos integer, pacotes integer, falhas integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c record;
  v_r record;
  v_off integer;
  v_pag integer;
  v_desde timestamptz;
  v_inicio timestamptz;
  n_contas integer := 0; n_ped integer := 0; n_pac integer := 0; n_falhas integer := 0;
begin
  for v_c in
    select ct.id, ct.apelido, ct.importar_desde, ct.varrido_ate
    from public.contas ct
    join public.canais ca on ca.id = ct.canal_id
    where ca.slug = 'mercado_livre'
      and ct.situacao = 'conectada'
      and ct.importacao_pausada_em is null
    order by ct.criada_em
  loop
    n_contas := n_contas + 1;
    v_off := 0;
    v_pag := 0;
    v_inicio := now();

    -- De quando perguntar, nesta conta:
    --
    --   nunca antes do CHAO que a pessoa escolheu;
    --   nunca antes de 7 dias, para nao puxar meses numa tacada;
    --   e dali para frente, de onde a marca d'agua parou — ou da janela
    --   padrao, quando ainda nao ha marca.
    v_desde := greatest(
      coalesce(v_c.varrido_ate, v_inicio - coalesce(p_janela, interval '2 hours')),
      v_inicio - interval '7 days'
    );

    if v_c.importar_desde is not null then
      v_desde := greatest(v_desde, v_c.importar_desde);
    end if;

    begin
      loop
        select * into v_r from privado.sincronizar_conta_ml(
          v_c.id, v_desde, v_off, p_quantos);

        v_pag := v_pag + 1;

        if not v_r.ok then
          n_falhas := n_falhas + 1;
          update public.contas c
             set ultimo_erro = 'Varredura: ' || coalesce(v_r.motivo, '?')
                               || coalesce(' — ' || v_r.detalhe, ''),
                 atualizado_em = now()
           where c.id = v_c.id;
          exit;
        end if;

        n_ped := n_ped + coalesce(v_r.pedidos, 0);
        n_pac := n_pac + coalesce(v_r.pacotes, 0);

        exit when not coalesce(v_r.tem_mais, false)
               or v_pag >= greatest(coalesce(p_paginas, 6), 1);

        v_off := v_r.proximo_offset;
      end loop;

      if v_r.ok then
        -- A marca d'agua SO anda quando a varredura desta conta terminou sem
        -- erro E leu tudo o que havia. Se parou no teto de paginas, ainda ha
        -- fila para tras: mover a marca aqui seria pular o resto.
        --
        -- Seis horas de sobreposicao porque o filtro e por data de CRIACAO e
        -- o pedido so aparece depois de pago. Pedido criado as 10h e pago as
        -- 14h precisa que a janela ainda alcance as 10h.
        if not coalesce(v_r.tem_mais, false) then
          update public.contas c
             set varrido_ate = greatest(
                   coalesce(c.varrido_ate, v_inicio - interval '6 hours'),
                   v_inicio - interval '6 hours'),
                 atualizado_em = now()
           where c.id = v_c.id;
        end if;

        -- Deu certo: o erro anterior desta conta não vale mais.
        update public.contas c
           set ultimo_erro = null, atualizado_em = now()
         where c.id = v_c.id and c.ultimo_erro like 'Varredura%';
      end if;

    exception when others then
      n_falhas := n_falhas + 1;
      update public.contas c
         set ultimo_erro = 'Varredura falhou: ' || sqlerrm, atualizado_em = now()
       where c.id = v_c.id;
    end;
  end loop;

  return query select n_contas, n_ped, n_pac, n_falhas;
end;
$function$;

comment on function public.varrer_pedidos_ml is
  'Busca os pedidos pagos de cada conta conectada e nao pausada. De quando '
  'perguntar sai de tres coisas: o chao `importar_desde`, a marca dagua '
  '`varrido_ate` (que so anda quando a leitura termina inteira) e um teto de '
  '7 dias.';

-- -------------------------------------------------- ligar e desligar
create or replace function public.pausar_importacao(
  p_conta_id uuid,
  p_pausar boolean,
  p_motivo text default null
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $function$
declare v_tinha timestamptz;
begin
  if not public.pode('mexer_integracao') then
    return query select false, 'sem_permissao'; return;
  end if;

  select c.importacao_pausada_em into v_tinha
  from public.contas c where c.id = p_conta_id;

  if not found then
    return query select false, 'conta_nao_encontrada'; return;
  end if;

  if p_pausar then
    update public.contas c
       set importacao_pausada_em = coalesce(c.importacao_pausada_em, now()),
           importacao_pausa_motivo = nullif(btrim(coalesce(p_motivo, '')), ''),
           atualizado_em = now()
     where c.id = p_conta_id;
  else
    -- Ao voltar, a marca d'agua recua para o momento da PAUSA. Sem isto, os
    -- pedidos criados enquanto a conta esteve parada nunca entrariam: a marca
    -- ficou congelada no passado, mas o teto de 7 dias poderia ja ter passado
    -- por cima dela numa pausa longa. Recuar explicitamente deixa a intencao
    -- escrita, em vez de depender do teto.
    update public.contas c
       set varrido_ate = least(coalesce(c.varrido_ate, now()),
                               coalesce(v_tinha, now())) - interval '6 hours',
           importacao_pausada_em = null,
           importacao_pausa_motivo = null,
           atualizado_em = now()
     where c.id = p_conta_id;
  end if;

  return query select true, 'ok';
end;
$function$;

comment on function public.pausar_importacao is
  'Liga e desliga a entrada de pedidos de uma conta, sem desconectar. Ao '
  'voltar, a marca dagua recua ate o momento da pausa para os pedidos do '
  'periodo entrarem — respeitando o teto de 7 dias da varredura.';

revoke all on function public.pausar_importacao(uuid, boolean, text) from public, anon;
grant execute on function public.pausar_importacao(uuid, boolean, text) to authenticated;
