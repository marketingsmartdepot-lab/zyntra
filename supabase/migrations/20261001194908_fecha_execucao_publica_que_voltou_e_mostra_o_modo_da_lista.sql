-- Três coisas pequenas que a auditoria achou.
--
-- 1. `pacotes_filtrados` voltou a ter EXECUTE para PUBLIC. Não é descuido do
--    revoke antigo: ao recriar a função com o parâmetro novo `p_listas`, o
--    `create function` devolve o grant padrão do Postgres, e um revoke feito
--    contra a ASSINATURA ANTIGA não alcança a nova. Não vaza — a função tem
--    `where public.e_da_equipe()` por dentro e só devolve `id` — mas quem lê o
--    lint não sabe disso, e defesa em profundidade não se discute.
--
-- 2. `permissoes_possiveis` sem search_path fixo. É uma lista de VALUES, não
--    toca tabela nenhuma, então fixar é de graça.
--
-- 3. `listas_resumo` não dizia se a lista é de papel ou de coletor, e o painel
--    preenchia o vazio com "sem turno aberto na bancada" — uma tela que não
--    existe mais. Coluna nova vai no FIM: create or replace view não insere
--    coluna no meio da lista.

revoke execute on function
  public.pacotes_filtrados(public.etapa, text, uuid[], uuid[], text[], text[], integer, text[])
  from public, anon;

revoke execute on function public.permissoes_possiveis() from public, anon;

-- Funções de gatilho: só rodam como trigger, chamá-las direto dá erro. Fechar
-- é de graça e tira duas linhas do lint.
revoke execute on function public.normalizar_email_autorizado() from public, anon;
revoke execute on function public.sincronizar_tem_pin() from public, anon;

alter function public.permissoes_possiveis() set search_path = '';

create or replace view public.listas_resumo as
 select l.id,
    l.codigo,
    l.situacao,
    l.criada_em,
    l.iniciada_em,
    l.concluida_em,
    o.nome as separador,
    p.nome as gerada_por,
    count(lp.pacote_id)::integer as pacotes,
    coalesce(sum(pa.unidades_esperadas), 0::bigint)::integer as unidades,
    count(distinct pa.conta_id)::integer as contas,
    l.modo
   from public.listas_separacao l
     left join public.operadores o on o.id = l.separador_id
     left join public.perfis p on p.id = l.criada_por
     left join public.listas_pacotes lp on lp.lista_id = l.id
     left join public.pacotes pa on pa.id = lp.pacote_id
  group by l.id, l.codigo, l.situacao, l.criada_em, l.iniciada_em,
           l.concluida_em, o.nome, p.nome, l.modo;

comment on view public.listas_resumo is
  'Uma linha por lista de separacao, com quem gerou, quem separa, e se ela e '
  'de papel ou de coletor.';
