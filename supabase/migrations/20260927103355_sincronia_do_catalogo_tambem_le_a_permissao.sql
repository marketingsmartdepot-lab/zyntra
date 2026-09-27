-- Sincronizar com o Bling e buscar EAN eram só de administrador. Agora que
-- "Mexer no catálogo" existe como permissão, é ela que manda — senão a
-- caixinha marcada na Equipe não valeria para os dois botões que a tela do
-- Catálogo oferece. pode() continua devolvendo verdadeiro para admin, então
-- ninguém que já podia deixou de poder.
--
-- Mesma troca cirúrgica da migração anterior: lê a definição que está no
-- banco, substitui só a linha da trava, aborta se o trecho não aparecer
-- exatamente uma vez.
do $mig$
declare
  v record;
  v_def text;
  v_ocorrencias integer;
begin
  for v in
    select * from (values
      ('buscar_eans_agora',
       $de$if not public.e_admin() then$de$,
       $para$if not public.pode('mexer_catalogo') then$para$),
      ('sincronizar_catalogo_erp',
       $de$if not public.e_admin() then$de$,
       $para$if not public.pode('mexer_catalogo') then$para$)
    ) as t(funcao, de, para)
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v.funcao;

    if v_def is null then
      raise exception 'Funcao %() nao existe.', v.funcao;
    end if;

    if position(v.para in v_def) > 0 then
      raise notice '%() ja estava com a trava nova.', v.funcao;
      continue;
    end if;

    v_ocorrencias := (length(v_def) - length(replace(v_def, v.de, ''))) / length(v.de);
    if v_ocorrencias <> 1 then
      raise exception 'Em %() o trecho apareceu % vez(es), esperava 1.', v.funcao, v_ocorrencias;
    end if;

    execute replace(v_def, v.de, v.para);
    raise notice '%() agora le mexer_catalogo.', v.funcao;
  end loop;
end
$mig$;
