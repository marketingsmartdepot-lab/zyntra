-- As duas permissões da bancada saem do registro de PIN e viram permissão de
-- LOGIN, no grupo "Fazer".
--
-- Enquanto elas moravam no operador de PIN, marcá-las para a Cristina não
-- faria efeito nenhum: a permissão existiria num registro que ela não tem.
-- Caixinha que não faz nada é pior que caixinha nenhuma.
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
    ('bipar_por_sku',   'Fazer',    'Conferir digitando o SKU',
     'Quando o produto não tem código de barras. Bipar lê o que está na caixa; digitar é alguém afirmando o que está.', 'perfil', 15),
    ('reiniciar_conferencia','Fazer','Reiniciar conferência',
     'Zerar uma conferência em andamento. Apaga as leituras já feitas.', 'perfil', 16)
  ) as t(chave, grupo, rotulo, descricao, onde, ordem)
  order by ordem;
$fn$;

grant execute on function public.permissoes_possiveis() to authenticated;

-- definir_permissoes volta a ser simples: todas as chaves moram no perfil.
create or replace function public.definir_permissoes(
  p_pessoa uuid,
  p_permissoes text[]
) returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_perfil uuid;
  v_validas text[];
begin
  if not (public.pode('mexer_equipe') or public.e_admin()) then
    return query select false, 'sem_permissao'; return;
  end if;

  select p.id into v_perfil from public.perfis p where p.id = p_pessoa;

  if v_perfil is null then
    -- Pessoa só de bancada: não tem login, então não tem o que permitir. As
    -- permissões todas são de sistema agora.
    if exists (select 1 from public.operadores o where o.id = p_pessoa) then
      return query select false, 'so_bancada_nao_tem_permissao'; return;
    end if;
    return query select false, 'pessoa_nao_encontrada'; return;
  end if;

  if v_perfil = auth.uid()
     and not public.e_admin()
     and not ('mexer_equipe' = any(coalesce(p_permissoes, '{}'))) then
    return query select false, 'nao_tire_a_sua_propria'; return;
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_validas
  from unnest(coalesce(p_permissoes, '{}')) x
  where x in (select pp.chave from public.permissoes_possiveis() pp);

  update public.perfis p set permissoes = v_validas where p.id = v_perfil;

  return query select true, 'ok';
end;
$fn$;

revoke all on function public.definir_permissoes(uuid, text[]) from public;
grant execute on function public.definir_permissoes(uuid, text[]) to authenticated;
