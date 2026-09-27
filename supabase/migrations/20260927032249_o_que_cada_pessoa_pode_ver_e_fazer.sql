-- Hoje só existe "administrador ou não". Ela quer escolher, pessoa por pessoa,
-- o que cada uma enxerga e faz.
--
-- Administrador continua podendo tudo, sem marcar nada — ela é a dona, e uma
-- lista de permissões que precisa estar completa para a dona funcionar é uma
-- lista que um dia vai travar a dona.
--
-- As chaves são frentes e ações reais, não abstrações: quem cadastra gente não
-- devia precisar traduzir nome de tabela.

alter table public.perfis
  add column if not exists permissoes text[] not null default '{}';

comment on column public.perfis.permissoes is
  'O que esta pessoa enxerga e faz. Vazio = só o que todo mundo da equipe vê. '
  'Administrador ignora esta lista: pode tudo.';

/**
 * A pessoa de agora pode isto?
 *
 * Administrador pode tudo. O resto depende da lista — e a pergunta é sempre
 * pela chave, nunca pelo papel, para que mudar a régua de alguém não exija
 * mexer em código.
 */
create or replace function public.pode(p_chave text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.perfis p
    where p.id = auth.uid()
      and p.ativo
      and (p.papel = 'admin' or p_chave = any(p.permissoes))
  );
$$;

revoke all on function public.pode(text) from public;
grant execute on function public.pode(text) to authenticated;

/**
 * As permissões que existem, com o nome que aparece na tela.
 *
 * Fica no banco, e não na tela, porque quem decide se uma ação é permitida é o
 * banco — a lista tem de sair do mesmo lugar que a decisão.
 */
create or replace function public.permissoes_possiveis()
returns table(chave text, grupo text, rotulo text, descricao text, ordem integer)
language sql
stable
as $$
  select * from (values
    ('ver_painel',      'Enxergar', 'Painel',
     'Os números do dia e o que está parado.', 1),
    ('ver_expedicao',   'Enxergar', 'Expedição',
     'A esteira: Aberto, Faturado, Separar, Conferir, Pronto.', 2),
    ('ver_logistica',   'Enxergar', 'Logística',
     'Doca, saída e o fechamento do Flex.', 3),
    ('ver_catalogo',    'Enxergar', 'Catálogo',
     'Os produtos que vieram do Bling.', 4),
    ('ver_integracao',  'Enxergar', 'Integração',
     'Contas, impressoras, operadores e equipe.', 5),
    ('ver_valores',     'Enxergar', 'Valores e custos',
     'Preço do pedido e custo de envio. Sem isto, as colunas de dinheiro somem.', 6),

    ('mexer_integracao','Fazer',    'Conectar contas e impressoras',
     'Ligar conta do Mercado Livre, trocar credencial, mexer em impressora.', 10),
    ('mexer_catalogo',  'Fazer',    'Mexer no catálogo',
     'Apagar produto, restaurar ignorado, sincronizar com o Bling.', 11),
    ('mexer_equipe',    'Fazer',    'Mexer na equipe',
     'Autorizar pessoa, tirar acesso, mudar o que cada uma pode.', 12),
    ('gerar_lista',     'Fazer',    'Gerar lista de separação',
     'Fechar um lote em Separar e mandar para Conferir.', 13),
    ('reter_pedido',    'Fazer',    'Reter e devolver pedido',
     'Tirar da esteira quando o problema é do canal, e trazer de volta.', 14)
  ) as t(chave, grupo, rotulo, descricao, ordem)
  order by ordem;
$$;

grant execute on function public.permissoes_possiveis() to authenticated;

/**
 * Muda o que uma pessoa pode.
 *
 * Só quem pode mexer na equipe. E ninguém tira a própria permissão de mexer na
 * equipe: seria trancar a porta por dentro e jogar a chave fora.
 */
create or replace function public.definir_permissoes(
  p_pessoa uuid,
  p_permissoes text[]
) returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_validas text[];
begin
  if not (public.pode('mexer_equipe') or public.e_admin()) then
    return query select false, 'sem_permissao'; return;
  end if;

  if p_pessoa = auth.uid()
     and not public.e_admin()
     and not ('mexer_equipe' = any(coalesce(p_permissoes, '{}'))) then
    return query select false, 'nao_tire_a_sua_propria'; return;
  end if;

  -- Só chaves que existem. Guardar chave inventada é guardar permissão que
  -- nunca vai ser conferida por ninguém.
  select array_agg(distinct x) into v_validas
  from unnest(coalesce(p_permissoes, '{}')) x
  where x in (select chave from public.permissoes_possiveis());

  update public.perfis p
     set permissoes = coalesce(v_validas, '{}')
   where p.id = p_pessoa;

  if not found then
    return query select false, 'pessoa_nao_encontrada'; return;
  end if;

  return query select true, 'ok';
end;
$$;

revoke all on function public.definir_permissoes(uuid, text[]) from public;
grant execute on function public.definir_permissoes(uuid, text[]) to authenticated;
