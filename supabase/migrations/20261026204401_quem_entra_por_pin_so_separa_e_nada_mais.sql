-- Quem entra por PIN no celular SO SEPARA. Ordem da Daniele, textual: "a
-- pessoa que usa o pin só pode fazer a separacao nada MAIS".
--
-- Isso e mais apertado que `ver_expedicao`, que abre a esteira inteira — com
-- ela a pessoa veria Aberto, Faturado, Conferir, Pronto, os valores, e
-- poderia navegar para qualquer pacote. Um celular que fica na mao de quem
-- esta no corredor nao precisa de nada disso, e o que nao precisa estar la e
-- superficie a defender.
--
-- Nasce `separar_no_coletor`, que abre exatamente duas telas: a lista de
-- listas e a de bipar. Nenhuma frente do menu responde a ela, entao o menu
-- lateral nasce vazio para quem so a tem — nao ha para onde navegar.

create or replace function public.permissoes_possiveis()
returns table (chave text, grupo text, rotulo text, descricao text, onde text, ordem integer)
language sql
stable
set search_path to ''
as $function$
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

    ('separar_no_coletor','Enxergar','Separar no coletor',
     'Só a lista de separação e a tela de bipar. É o que a conta do aparelho usa: quem entra por PIN no celular não enxerga mais nada do sistema.', 'perfil', 7),

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
    ('bipar_por_sku',   'Fazer',    'Conferir digitando o SKU',
     'Quando o produto não tem código de barras. Bipar lê o que está na caixa; digitar é alguém afirmando o que está.', 'perfil', 15),
    ('reiniciar_conferencia','Fazer','Reiniciar conferência',
     'Zerar uma conferência em andamento. Apaga as leituras já feitas.', 'perfil', 16),
    ('alterar_etapa',   'Fazer',    'Alterar a etapa na mão',
     'Mover a caixa para qualquer etapa, furando o caminho normal da esteira. Exige motivo escrito, e o motivo fica no histórico da caixa.', 'perfil', 17),
    ('reprocessar_pedido','Fazer',  'Reprocessar pedido',
     'Perguntar ao canal de novo o estado do pedido. Destrava etiqueta que o Mercado Livre já liberou mas que o ZYNTRA ainda não enxergou.', 'perfil', 18)
  ) as t(chave, grupo, rotulo, descricao, onde, ordem)
  order by ordem;
$function$;

-- A pessoa escolhe qual lista vai separar. So as que estao EM SEPARACAO e no
-- modo coletor: lista de papel ja saiu impressa e nao se bipa, e lista
-- fechada nao tem o que fazer.
create or replace function public.listas_do_coletor()
returns table (
  id uuid, codigo text, caixas integer, itens integer, lidos integer,
  criada_em timestamptz, separador text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    ls.id,
    ls.codigo,
    (select count(*)::integer from public.listas_pacotes lp where lp.lista_id = ls.id),
    coalesce((select sum(sp.esperado)::integer
                from public.separacao_progresso sp where sp.lista_id = ls.id), 0),
    coalesce((select sum(sp.separado)::integer
                from public.separacao_progresso sp where sp.lista_id = ls.id), 0),
    ls.criada_em,
    (select coalesce(nullif(btrim(o.nome), ''), '')
       from public.operadores o where o.id = ls.separador_id)
  from public.listas_separacao ls
  where ls.situacao = 'em_separacao'
    and ls.modo = 'coletor'
  order by ls.criada_em;
$function$;

comment on function public.listas_do_coletor is
  'As listas que o celular oferece para separar: so em separacao e so no modo '
  'coletor.';

revoke all on function public.listas_do_coletor() from public, anon;
grant execute on function public.listas_do_coletor() to authenticated;
