-- Fecha o que o linter de segurança do Supabase apontou na fundação.
--
-- 1. `tocar_atualizado_em` estava com search_path mutável: dá para sequestrar
--    a função plantando um objeto num schema que entre na frente no path.
-- 2. As funções `security definer` ficaram expostas como RPC em /rest/v1/rpc.
--    Nenhuma delas é para ser chamada de fora.

alter function public.tocar_atualizado_em() set search_path = '';

-- Função de gatilho: ninguém chama pela API. O gatilho continua rodando
-- normalmente, porque ele não passa pelo GRANT de execução.
revoke all on function public.criar_perfil_para_novo_usuario()
  from public, anon, authenticated;

-- Estas duas são lidas pelas políticas de RLS, então `authenticated` precisa
-- poder executar. Só o anônimo sai. Ambas devolvem apenas o papel de quem
-- está chamando, então executar não vaza nada de terceiros.
revoke all on function public.papel_atual() from public, anon;
revoke all on function public.e_admin() from public, anon;

grant execute on function public.papel_atual() to authenticated;
grant execute on function public.e_admin() to authenticated;
