-- A tela de operadores precisa mostrar quem pode reiniciar conferência e quem
-- pode conferir digitando o SKU. Sem isso as permissões existiriam no banco e
-- ninguém conseguiria ligá-las.
--
-- Colunas novas vão no FIM: o Postgres não deixa inserir no meio de uma view
-- existente, e recriar do zero derrubaria as permissões concedidas a ela.
drop view if exists public.operadores_situacao;

create view public.operadores_situacao
with (security_invoker = true)
as
 SELECT id,
    nome,
    papel,
    ativo,
    tem_pin,
    tentativas_falhas,
    bloqueado_ate,
    bloqueado_ate IS NOT NULL AND bloqueado_ate > now() AS bloqueado,
    criado_em,
    ( SELECT se.estacao_id
           FROM sessoes_estacao se
          WHERE se.operador_id = o.id AND se.encerrada_em IS NULL
          ORDER BY se.iniciada_em DESC
         LIMIT 1) AS em_turno_na_estacao,
    pode_reiniciar_conferencia,
    pode_bipar_por_sku
   FROM operadores o;

grant select on public.operadores_situacao to authenticated;
