-- Uma lista só de pessoas.
--
-- Ela pediu "nessa aba preciso colocar o que cada pessoa pode olhar e fazer,
-- ex essa questao de bipagem", e eu respondi que bipagem morava em OUTRA aba,
-- porque quem trabalha na bancada entra por PIN e não tem login. O problema da
-- encanação era meu, não dela. Ela quer uma tela onde escolhe o que cada
-- pessoa pode, e bipar é uma dessas coisas.
--
-- Então as duas listas viram uma. Entrar por e-mail, por PIN, ou pelos dois
-- passa a ser um ATRIBUTO da pessoa, não duas telas de gente.

-- 1. A ponte entre as duas listas ------------------------------------------
alter table public.operadores
  add column if not exists perfil_id uuid references public.perfis(id) on delete set null;

comment on column public.operadores.perfil_id is
  'O login desta mesma pessoa, quando ela tem um. Nulo = só trabalha na '
  'bancada, entra por PIN e não tem e-mail no sistema.';

create unique index if not exists operadores_um_por_perfil
  on public.operadores (perfil_id) where perfil_id is not null;

-- 2. A bipagem entra na lista de permissões --------------------------------
--
-- Ganha a coluna `onde`, que diz em qual tabela a permissão mora. É ela que
-- deixa UMA tela salvar permissões que vivem em dois lugares sem que quem
-- marca a caixinha precise saber disso.
drop function if exists public.permissoes_possiveis();

create function public.permissoes_possiveis()
returns table(chave text, grupo text, rotulo text, descricao text,
              onde text, ordem integer)
language sql
stable
as $fn$
  select * from (values
    ('ver_painel',      'Enxergar', 'Painel',
     'Os números do dia e o que está parado.', 'perfil', 1),
    ('ver_expedicao',   'Enxergar', 'Expedição',
     'A esteira: Aberto, Faturado, Separar, Conferir, Pronto.', 'perfil', 2),
    ('ver_logistica',   'Enxergar', 'Logística',
     'Doca, saída e o fechamento do Flex.', 'perfil', 3),
    ('ver_catalogo',    'Enxergar', 'Catálogo',
     'Os produtos que vieram do Bling.', 'perfil', 4),
    ('ver_integracao',  'Enxergar', 'Integração',
     'Contas, impressoras e pessoas.', 'perfil', 5),
    ('ver_valores',     'Enxergar', 'Valores e custos',
     'Preço do pedido e custo de envio. Sem isto, as colunas de dinheiro somem.', 'perfil', 6),

    ('mexer_integracao','Fazer',    'Conectar contas e impressoras',
     'Ligar conta do Mercado Livre, trocar credencial, mexer em impressora.', 'perfil', 10),
    ('mexer_catalogo',  'Fazer',    'Mexer no catálogo',
     'Apagar produto, restaurar ignorado, sincronizar com o Bling.', 'perfil', 11),
    ('mexer_equipe',    'Fazer',    'Mexer nas pessoas',
     'Cadastrar gente, tirar acesso, mudar o que cada uma pode.', 'perfil', 12),
    ('gerar_lista',     'Fazer',    'Gerar lista de separação',
     'Fechar um lote em Separar e mandar para Conferir.', 'perfil', 13),
    ('reter_pedido',    'Fazer',    'Reter e devolver pedido',
     'Tirar da esteira quando o problema é do canal, e trazer de volta.', 'perfil', 14),

    ('bipar_por_sku',        'Na bancada', 'Conferir digitando o SKU',
     'Quando o produto não tem código de barras. Bipar lê o que está na caixa; '
     'digitar é alguém afirmando o que está.', 'bancada', 20),
    ('reiniciar_conferencia','Na bancada', 'Reiniciar conferência',
     'Zerar uma conferência em andamento. Apaga as leituras já feitas.', 'bancada', 21)
  ) as t(chave, grupo, rotulo, descricao, onde, ordem)
  order by ordem;
$fn$;

grant execute on function public.permissoes_possiveis() to authenticated;

-- 3. A lista: toda pessoa, uma linha ---------------------------------------
--
-- Quem tem login aparece pelo perfil, com a bancada pendurada quando existe.
-- Quem só tem PIN aparece pelo operador. Uma pessoa nas duas pontas é UMA
-- linha — é por isso que a ponte do passo 1 existe.
drop view if exists public.pessoas;

create view public.pessoas
with (security_invoker = true)
as
  select
    p.id                                   as pessoa_id,
    p.id                                   as perfil_id,
    o.id                                   as operador_id,
    coalesce(nullif(btrim(p.nome), ''), p.email) as nome,
    p.email,
    p.papel::text                          as papel,
    p.ativo,
    p.criado_em,
    (exists (select 1 from public.equipe_autorizada a
              where lower(a.email) = lower(p.email)))  as autorizada,
    (o.id is not null)                     as na_bancada,
    coalesce(o.tem_pin, false)             as tem_pin,
    coalesce(o.bloqueado_ate is not null and o.bloqueado_ate > now(), false) as bloqueado,
    coalesce(o.tentativas_falhas, 0)       as tentativas_falhas,
    p.permissoes
      || case when coalesce(o.pode_bipar_por_sku, false)
              then array['bipar_por_sku'] else '{}'::text[] end
      || case when coalesce(o.pode_reiniciar_conferencia, false)
              then array['reiniciar_conferencia'] else '{}'::text[] end
                                           as permissoes
  from public.perfis p
  left join public.operadores o on o.perfil_id = p.id

  union all

  select
    o.id, null::uuid, o.id,
    o.nome, null::text, o.papel::text, o.ativo, o.criado_em,
    false, true,
    o.tem_pin,
    (o.bloqueado_ate is not null and o.bloqueado_ate > now()),
    o.tentativas_falhas,
    (case when o.pode_bipar_por_sku then array['bipar_por_sku'] else '{}'::text[] end
     || case when o.pode_reiniciar_conferencia then array['reiniciar_conferencia'] else '{}'::text[] end)
  from public.operadores o
  where o.perfil_id is null;

grant select on public.pessoas to authenticated;

-- `operadores` nunca teve SELECT para authenticated, e a view que a tela usa é
-- security_invoker: a aba Operadores estava quebrando com "permission denied
-- for table operadores". A RLS já limita a leitura à equipe.
grant select on public.operadores to authenticated;

-- E a escrita direta sai. Era ela que deixava um líder ligar a bipagem de
-- qualquer um com uma chamada solta, sem passar por permissão nenhuma —
-- justamente a coisa que ela quer controlar nesta tela.
revoke insert, update, delete on public.operadores from authenticated;

