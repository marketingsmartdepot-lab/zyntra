-- As permissões passam a valer.
--
-- Até aqui as cinco permissões do grupo "Fazer" existiam na coluna do perfil e
-- na tela da Equipe, mas NENHUMA função do banco as lia: quem mandava era o
-- PAPEL (operador/lider/admin). Marcar a caixinha não mudava nada, e um líder
-- com "Mexer no catálogo" desmarcado apagava SKU do mesmo jeito. Permissão que
-- só enfeita tela é pior que permissão nenhuma, porque a dona confia nela.
--
-- A troca é cirúrgica de propósito. Em vez de reescrever seis corpos de função
-- à mão — seis chances de trocar por acidente uma linha de regra do galpão —
-- este bloco lê do banco a definição que está valendo, substitui SÓ a linha da
-- trava e executa o resultado. Se algum trecho não aparecer exatamente uma vez,
-- a migração aborta inteira em vez de aplicar metade.
--
-- pode() já devolve verdadeiro para admin em qualquer chave, então a dona não
-- depende de ninguém ter lembrado de marcar caixinha nenhuma.
do $mig$
declare
  v record;
  v_def text;
  v_novo text;
  v_ocorrencias integer;
begin
  for v in
    select * from (values

      -- Gerar lista de separação: o clique que manda o lote inteiro para a
      -- conferência. Era liberado para qualquer perfil ativo.
      ('criar_lista',
       $de$perform public.exige_perfil_ativo();$de$,
       $para$perform public.exige_perfil_ativo();
  if not public.pode('gerar_lista') then
    return query select false, 'sem_permissao', null::uuid, 0, 0; return;
  end if;$para$),

      -- Reter pedido: tira o pacote da esteira. Era liberado para qualquer
      -- perfil ativo.
      ('reter_pacotes',
       $de$perform public.exige_perfil_ativo();$de$,
       $para$perform public.exige_perfil_ativo();
  if not public.pode('reter_pedido') then
    return query select false, 'sem_permissao', 0, null::jsonb; return;
  end if;$para$),

      -- Devolver pedido à esteira: o outro lado da mesma permissão.
      ('tirar_do_retido',
       $de$perform public.exige_perfil_ativo();$de$,
       $para$perform public.exige_perfil_ativo();
  if not public.pode('reter_pedido') then
    return query select false, 'sem_permissao', 0, null::jsonb; return;
  end if;$para$),

      -- Apagar SKU do catálogo: era por papel (lider/admin).
      ('excluir_skus',
       $de$coalesce(public.papel_atual()::text,'') not in ('lider','admin')$de$,
       $para$not public.pode('mexer_catalogo')$para$),

      -- Custo do Flex por etiqueta: era por papel (admin).
      ('definir_custo_etiqueta',
       $de$coalesce(public.papel_atual()::text, '') not in ('admin')$de$,
       $para$not public.pode('mexer_integracao')$para$),

      -- PIN do operador: é a identidade da bancada. Era por papel
      -- (lider/admin).
      ('definir_pin_operador',
       $de$coalesce(public.papel_atual()::text, '') not in ('lider', 'admin')$de$,
       $para$not public.pode('mexer_integracao')$para$)

    ) as t(funcao, de, para)
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v.funcao;

    if v_def is null then
      raise exception 'Função %() não existe — a migração parou sem mexer em nada.', v.funcao;
    end if;

    -- Já aplicada? Então o trecho antigo não está mais lá, e passar batido é o
    -- certo: a migração precisa poder rodar duas vezes.
    if position(v.para in v_def) > 0 then
      raise notice '%() já estava com a trava nova.', v.funcao;
      continue;
    end if;

    v_ocorrencias := (length(v_def) - length(replace(v_def, v.de, ''))) / length(v.de);

    if v_ocorrencias <> 1 then
      raise exception 'Em %() o trecho da trava apareceu % vez(es), esperava 1. Nada foi aplicado.',
        v.funcao, v_ocorrencias;
    end if;

    v_novo := replace(v_def, v.de, v.para);
    execute v_novo;
    raise notice '%() agora lê a permissão.', v.funcao;
  end loop;
end
$mig$;
