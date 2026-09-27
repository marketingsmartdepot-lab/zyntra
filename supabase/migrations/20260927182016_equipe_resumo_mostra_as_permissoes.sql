-- A coluna `permissoes` entrou na view por fora, num comando solto, e por isso
-- não estava em migração nenhuma: quem reconstruísse o banco a partir do git
-- teria a tela da Equipe sem a coluna "O que pode". Esta migração registra o
-- que já está no ar.
--
-- E tira de authenticated o INSERT/UPDATE/DELETE que a view carregava sem
-- precisar. Não era brecha — a view é security_invoker e authenticated só tem
-- SELECT em perfis, então a escrita morria no privilégio da tabela — mas
-- permissão que ninguém usa é permissão que um dia engana quem lê.
create or replace view public.equipe_resumo
with (security_invoker = true)
as
 SELECT id,
    nome,
    email,
    papel,
    ativo,
    criado_em,
    (EXISTS ( SELECT 1
           FROM public.equipe_autorizada a
          WHERE lower(a.email) = lower(p.email))) AS autorizada,
    ( SELECT a.criada_em
           FROM public.equipe_autorizada a
          WHERE lower(a.email) = lower(p.email)
         LIMIT 1) AS autorizada_em,
    permissoes
   FROM public.perfis p;

revoke insert, update, delete on public.equipe_resumo from authenticated;
grant select on public.equipe_resumo to authenticated;
