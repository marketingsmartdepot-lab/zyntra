-- FURO QUE EU ABRI, e que o teste pegou antes de ir para o galpao.
--
-- A sessao que o PIN abre e de um perfil ativo. E quase toda politica de RLS
-- deste banco pergunta `e_da_equipe()`, que significa "existe um perfil ativo
-- com este auth.uid()". Entao a conta do aparelho passava em TODAS: li
-- `contas`, `pacotes` e os e-mails de `perfis` com a sessao dela, de fora,
-- com um curl.
--
-- "Só pode fazer a separação" nao pode ser uma decisao de TELA. Esconder o
-- menu nao protege nada de quem abre o console do navegador no celular — e
-- celular de galpao e o aparelho mais facil de alguem pegar emprestado.
--
-- O conserto e na raiz: a conta do aparelho deixa de ser "da equipe". Uma
-- linha em `e_da_equipe()`, e todas as politicas que dependem dela fecham de
-- uma vez — inclusive as que ainda nao existem.
--
-- As tres funcoes que o coletor chama (`bipar_separacao`, `somar_na_separacao`
-- e `fechar_separacao`) sao `security definer` e passam por cima da RLS — por
-- isso continuam funcionando, e e por isso que a guarda delas precisa ser a
-- permissao, nao a RLS.

create or replace function public.garantir_perfil_do_aparelho(
  p_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.perfis (id, email, nome, papel, ativo, permissoes)
  values (p_id, p_email, 'Coletor do galpão', 'aparelho', true,
          array['separar_no_coletor'])
  on conflict (id) do update
    set ativo = true,
        nome = 'Coletor do galpão',
        papel = 'aparelho',
        permissoes = array['separar_no_coletor'];
end;
$function$;

comment on function public.garantir_perfil_do_aparelho is
  'O perfil da conta do aparelho: papel `aparelho` e SO `separar_no_coletor`. '
  'Reaplicado a cada entrada por PIN, entao permissao acrescentada na mao nao '
  'sobrevive.';

revoke all on function public.garantir_perfil_do_aparelho(uuid, text)
  from public, anon, authenticated;
grant execute on function public.garantir_perfil_do_aparelho(uuid, text) to service_role;

update public.perfis
   set papel = 'aparelho', permissoes = array['separar_no_coletor']
 where email = 'coletor@aparelho.zyntra';

create or replace function public.e_da_equipe()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.perfis
    where id = auth.uid()
      and ativo
      -- A conta do aparelho e ativa de proposito — ela precisa abrir sessao —
      -- mas NAO e da equipe. Sem esta linha ela le o banco inteiro, porque e
      -- isto que quase toda politica deste sistema pergunta.
      and coalesce(papel::text, '') <> 'aparelho'
  );
$function$;

comment on function public.e_da_equipe is
  'Quem pertence a equipe: perfil ativo que nao seja a conta de um aparelho.';

drop policy if exists "coletor le as listas que esta separando" on public.listas_separacao;

create policy "coletor le as listas que esta separando"
on public.listas_separacao
for select
to authenticated
using (
  public.pode('separar_no_coletor')
  and situacao = 'em_separacao'
  and modo = 'coletor'
);
