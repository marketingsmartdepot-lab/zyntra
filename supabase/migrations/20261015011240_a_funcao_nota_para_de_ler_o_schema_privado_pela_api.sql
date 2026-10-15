-- A função `nota` lia `privado.config` e `privado.credenciais_conta` pelo
-- PostgREST, com a chave de serviço. Isso nunca podia funcionar: o schema
-- `privado` é SELADO — nenhum papel tem grant em nenhuma tabela dele, e é
-- por isso que o lint de "RLS sem política" aparece nelas. São nega-tudo,
-- alcançáveis só por função `security definer` que pertence ao postgres.
--
-- Era um defeito latente: o código foi escrito, nunca publicado, nunca
-- executado. Apareceu no primeiro teste das travas — as chamadas com o
-- segredo CORRETO voltaram `segredo_invalido`, porque a função lia vazio.
--
-- O conserto é o padrão que o resto do sistema já usa (privado.token_ml, que
-- `pedir_etiquetas_ml` chama): função em `public`, `security definer`, com
-- execute só para `service_role`. O schema `privado` continua fora da API.

/**
 * Confere o segredo interno sem devolvê-lo.
 *
 * Melhor que entregar o segredo para quem chamou comparar: ele nunca sai do
 * banco. A comparação é feita sobre o md5 dos dois lados — duas cadeias de 32
 * caracteres hexadecimais — para que o tempo de resposta não revele quantos
 * caracteres iniciais do segredo bateram.
 */
create or replace function public.segredo_interno_confere(p_segredo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from privado.config c
    where c.chave = 'segredo_interno'
      and coalesce(c.valor, '') <> ''
      and md5(c.valor) = md5(coalesce(p_segredo, ''))
  );
$$;

comment on function public.segredo_interno_confere is
  'Diz se o segredo recebido e o interno, sem devolver o segredo. Só service_role.';

/**
 * O token do Mercado Livre de uma conta, renovado se estiver vencendo.
 *
 * Embrulha privado.token_ml, que já resolve a renovação a 5 minutos do
 * vencimento. Por isso quem chama não precisa mais checar validade: ou vem
 * token bom, ou vem o motivo (`sem_conexao`, `precisa_reconectar`).
 */
create or replace function public.token_do_canal(p_conta_id uuid)
returns table (token text, motivo text)
language sql
volatile
security definer
set search_path = ''
as $$
  select t.token, t.motivo from privado.token_ml(p_conta_id) t;
$$;

comment on function public.token_do_canal is
  'Token do ML de uma conta, renovado se vencendo. Só service_role.';

revoke all on function public.segredo_interno_confere(text) from public, anon, authenticated;
revoke all on function public.token_do_canal(uuid) from public, anon, authenticated;
grant execute on function public.segredo_interno_confere(text) to service_role;
grant execute on function public.token_do_canal(uuid) to service_role;

-- Sujeira do teste das travas.
delete from privado.config where chave like '\_teste\_%';
