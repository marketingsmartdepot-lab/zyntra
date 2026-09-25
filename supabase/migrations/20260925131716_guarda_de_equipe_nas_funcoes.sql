-- Guarda de equipe nas funções da operação.
--
-- Fechar a leitura das tabelas não protege nada enquanto a escrita mora numa
-- função SECURITY DEFINER: ela passa por cima do RLS por definição. A varredura
-- achou 21 funções assim, chamáveis por qualquer pessoa logada — inclusive
-- alguém cujo perfil está inativo. Dava para gerar lista, bipar saída, fechar
-- conferência, mandar ZPL arbitrário para a impressora da bancada e ler o
-- faturamento pelo painel.

-- Internas: a aplicação não chama nenhuma das duas. `bipar_saida` é a versão
-- por id, usada só por `bipar_saida_por_codigo`; `itens_para_baixa` é peça da
-- máquina de baixa de estoque, que roda por cron como postgres. Para essas,
-- revogar é melhor do que proteger — ninguém de fora tem o que fazer com elas.
revoke execute on function public.bipar_saida(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.itens_para_baixa(uuid) from public, anon, authenticated;

-- O laço lê a lista do catálogo em vez de eu digitar 13 nomes. Lista digitada
-- esquece uma função e ninguém percebe — e é justamente a esquecida que vira a
-- porta. Cada uma dessas tem exatamente uma linha que é só `begin`, então o
-- ponto de inserção é único e não há ambiguidade.
do $outer$
declare
  r record;
  def text;
  novo text;
  n integer := 0;
  faltou text[] := '{}';
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_language l on l.oid = p.prolang
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prosecdef
      and p.prokind = 'f'
      and l.lanname = 'plpgsql'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.prosrc !~ 'exige_perfil_ativo|e_da_equipe|e_admin|papel_atual|p_token'
  loop
    def := pg_get_functiondef(r.oid);

    novo := regexp_replace(
      def,
      '(\n[[:space:]]*begin[[:space:]]*\n)',
      E'\\1  perform public.exige_perfil_ativo();\n',
      ''
    );

    if novo = def then
      faltou := faltou || r.proname;
    else
      execute novo;
      n := n + 1;
    end if;
  end loop;

  if array_length(faltou, 1) is not null then
    raise exception 'sem ponto de insercao em: %', array_to_string(faltou, ', ');
  end if;

  raise notice 'funcoes plpgsql protegidas: %', n;
end $outer$;
