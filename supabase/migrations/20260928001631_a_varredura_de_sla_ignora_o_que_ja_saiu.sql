-- Última função que ainda falava 'encerrado'. Aproveita para ignorar também a
-- etapa nova: caixa que já está no caminhão não tem mais prazo de despacho a
-- consultar no ML.
do $mig$
declare v_def text; v_n integer;
  v_de text := $de$pa.etapa not in ('pronto', 'encerrado')$de$;
  v_para text := $para$pa.etapa not in ('pronto', 'envio', 'enviado')$para$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'varrer_slas_ml';

  if position(v_para in v_def) > 0 then
    raise notice 'varrer_slas_ml ja estava atualizada.';
  else
    v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
    if v_n <> 1 then
      raise exception 'varrer_slas_ml: trecho apareceu % vez(es).', v_n;
    end if;
    execute replace(v_def, v_de, v_para);
  end if;
end
$mig$;
