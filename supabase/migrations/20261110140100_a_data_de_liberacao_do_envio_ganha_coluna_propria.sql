-- A data de liberacao do envio ganha coluna propria.
--
-- `limite_envio_em` carregava dois significados opostos, e um apagava o outro:
--
--   liberacao da etiqueta -> "nao da para fazer NADA antes disto"
--   prazo de despacho     -> "tem que SAIR ate isto"
--
-- `privado.envio_do_ml` lia a liberacao de shipping_option.buffering.date e
-- gravava origem 'liberacao da etiqueta'. Depois `privado.buscar_sla_do_envio`
-- passava e sobrescrevia as duas colunas com o prazo de despacho do SLA. Mesma
-- coluna, dois escritores, ultimo ganha -- e o que se perdia era sempre a
-- liberacao, porque o SLA chega depois.
--
-- Medido em 10/11/2026 nos 19 envios parados em Aberto aguardando o canal:
-- 18 tem a data de liberacao no JSON cru guardado em `envios.bruto`, e ZERO
-- tem estimated_handling_limit. Ou seja: o dado sempre esteve ali e sempre foi
-- apagado depois. (Isto corrige o que eu escrevi no commit 7c41230, onde
-- culpei a precedencia do coalesce em envio_do_ml -- nao e ela, e a
-- sobrescrita.)
--
-- Agora sao duas colunas, cada uma com um dono:
--
--   limite_envio_em / limite_origem -> prazo de despacho, de quem ja escrevia
--   libera_etiqueta_em              -> liberacao, de envio_do_ml
--
-- `buscar_sla_do_envio` NAO muda e nao precisa mudar: ela continua escrevendo
-- onde escrevia, e agora isso nao destroi mais nada.
--
-- O backfill sai de `envios.bruto`, sem uma unica chamada ao ML: a varredura
-- ja guarda o JSON cru do envio, entao a resposta que apagamos continua la.

alter table public.envios
  add column if not exists libera_etiqueta_em timestamptz;

comment on column public.envios.libera_etiqueta_em is
  'Quando o canal libera a etiqueta deste envio (shipping_option.buffering.date '
  'do ML). Diferente de limite_envio_em, que e prazo para despachar: esta diz '
  'quando da para COMECAR, aquela diz quando tem que ter TERMINADO.';

-- envio_do_ml passa a devolver a liberacao separada do prazo. Precisa de drop
-- porque muda a assinatura de retorno.
drop function if exists privado.envio_do_ml(jsonb);

create function privado.envio_do_ml(v_s jsonb)
returns table(modalidade text, prazo timestamptz, origem text,
              libera_em timestamptz)
language sql
immutable
set search_path to ''
as $function$
  select
    coalesce(v_s->>'logistic_type', v_s#>>'{logistic,type}'),
    -- O prazo de despacho segue sendo o prazo. Quando ele nao existe, a
    -- liberacao ainda serve de data limite para a tela nao ficar vazia -- mas
    -- agora a liberacao TAMBEM vai na coluna dela, e nao se perde.
    coalesce(
      nullif(v_s#>>'{shipping_option,estimated_handling_limit,date}','')::timestamptz,
      nullif(v_s#>>'{shipping_option,buffering,date}','')::timestamptz),
    case
      when nullif(v_s#>>'{shipping_option,estimated_handling_limit,date}','') is not null
        then 'limite de despacho'
      when nullif(v_s#>>'{shipping_option,buffering,date}','') is not null
        then 'liberacao da etiqueta'
    end,
    nullif(v_s#>>'{shipping_option,buffering,date}','')::timestamptz;
$function$;

-- sincronizar_conta_ml e longa e eu mexo em tres pontos dela. Em vez de
-- reescrever o corpo inteiro -- onde um erro de transcricao passa calado --
-- a troca e cirurgica sobre a definicao que o banco tem, com assercao de que
-- cada ancora aparece exatamente uma vez.
do $mig$
declare
  v_def text;
  v_novo text;
begin
  v_def := pg_get_functiondef('privado.sincronizar_conta_ml'::regproc);

  if (select count(*) from regexp_matches(v_def,
        'limite_envio_em, limite_origem, volumes, bruto, sincronizado_em\)', 'g')) <> 1 then
    raise exception 'ancora da lista de colunas nao apareceu exatamente uma vez';
  end if;

  if (select count(*) from regexp_matches(v_def,
        'v_lido\.prazo, v_lido\.origem,', 'g')) <> 1 then
    raise exception 'ancora dos valores nao apareceu exatamente uma vez';
  end if;

  if (select count(*) from regexp_matches(v_def,
        'limite_origem = coalesce\(excluded\.limite_origem, e\.limite_origem\),', 'g')) <> 1 then
    raise exception 'ancora do on conflict nao apareceu exatamente uma vez';
  end if;

  v_novo := replace(v_def,
    'limite_envio_em, limite_origem, volumes, bruto, sincronizado_em)',
    'limite_envio_em, limite_origem, libera_etiqueta_em, volumes, bruto, sincronizado_em)');

  v_novo := replace(v_novo,
    'v_lido.prazo, v_lido.origem,',
    'v_lido.prazo, v_lido.origem, v_lido.libera_em,');

  v_novo := replace(v_novo,
    'limite_origem = coalesce(excluded.limite_origem, e.limite_origem),',
    'limite_origem = coalesce(excluded.limite_origem, e.limite_origem),'
    || E'\n            libera_etiqueta_em = coalesce(excluded.libera_etiqueta_em, e.libera_etiqueta_em),');

  execute v_novo;
end;
$mig$;

-- Recupera o que foi apagado, do JSON cru que ja estava guardado.
update public.envios e
   set libera_etiqueta_em =
         nullif(e.bruto#>>'{shipping_option,buffering,date}','')::timestamptz
 where e.libera_etiqueta_em is null
   and e.bruto is not null
   and nullif(e.bruto#>>'{shipping_option,buffering,date}','') is not null;
