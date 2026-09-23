-- `revoke all from public` nao fechava nada. Fechando de verdade.
--
-- O Supabase define privilegio padrao no schema public concedendo EXECUTE em
-- toda funcao nova a `anon` e `authenticated`. Isso e um grant EXPLICITO para
-- esses papeis — e `revoke from public` nao mexe em grant explicito. Entao o
-- padrao usado no projeto inteiro (revoke from public, grant to authenticated)
-- deixava tudo aberto para anonimo o tempo todo.
--
-- O pior caso era `registrar_resposta_nota`: com a chave publica, que e
-- publica por definicao, qualquer um marcava uma nota como autorizada e fazia
-- o pacote andar para Faturado sem nota nenhuma existir.

alter default privileges in schema public revoke execute on functions from anon;

-- Anonimo perde tudo, menos o agente de impressao. O agente NAO tem sessao de
-- usuario: ele se identifica por token, verificado dentro da propria funcao.
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
    execute format('revoke execute on function %s from anon', f.assinatura);
  end loop;
end $$;

-- Funcoes que a equipe tambem nao deve chamar direto.
--
-- `registrar_resposta_nota` aplica a resposta do CANAL: so a Edge Function,
-- com a chave de servico. As outras sao engrenagem interna, chamadas de dentro
-- de outras funcoes (que rodam como donas e nao precisam do grant).
revoke execute on function public.registrar_resposta_nota(
  uuid, boolean, text, text, bigint, text, text, text, text, text, text
) from authenticated;
revoke execute on function public.reavaliar_pacote(uuid) from authenticated;
revoke execute on function public.destravar_por_mapeamento() from authenticated;
revoke execute on function public.chave_da_nota(uuid) from authenticated;
revoke execute on function public.pacote_por_codigo(text) from authenticated;
revoke execute on function public.solicitar_nota(uuid, boolean) from authenticated;

create or replace function public.limite_do_disjuntor()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5 $$;

-- `turnos_abertos` nao le segredo nenhum, entao nao ha razao para rodar como
-- dona. `operadores_situacao` continua como esta: ela precisa olhar
-- `pin_hash` para dizer SE existe PIN, e devolve so o booleano.
create or replace view public.turnos_abertos
with (security_invoker = true)
as
select
  se.id,
  se.estacao_id,
  e.nome as estacao,
  se.operador_id,
  o.nome as operador,
  o.papel,
  se.iniciada_em
from public.sessoes_estacao se
join public.estacoes e on e.id = se.estacao_id
join public.operadores o on o.id = se.operador_id
where se.encerrada_em is null;
