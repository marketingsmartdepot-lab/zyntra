-- Sobraram cinco: `anon` herdava delas pelo papel PUBLIC.
--
-- Revogar de `anon` nao adianta quando PUBLIC tem o privilegio, porque todo
-- papel herda de PUBLIC. Sao funcoes de gatilho e auxiliares triviais, entao
-- o risco era pequeno — mas invariante com excecao nao e invariante, e a
-- proxima pessoa que olhar a lista vai achar que esta fechada.
--
-- Revogar EXECUTE de funcao de gatilho nao quebra o gatilho: o Postgres nao
-- checa esse privilegio quando dispara um trigger, so quando alguem chama a
-- funcao diretamente — que e exatamente o que queremos impedir.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname not in ('agente_reservar_trabalhos', 'agente_concluir_trabalho')
  loop
    execute format('revoke execute on function %s from public, anon', f.assinatura);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public, anon;
