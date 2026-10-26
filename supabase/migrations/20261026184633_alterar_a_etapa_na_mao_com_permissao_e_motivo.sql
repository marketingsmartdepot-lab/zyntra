-- Mover uma caixa de etapa na mao, para destravar o caso que ninguem previu.
--
-- Decisoes da Daniele em 26/10, e cada uma muda o que esta aqui:
--
--   qualquer etapa -> qualquer etapa. Limitar seria escolher hoje qual
--   emergencia vale, e a que aparecer vai ser justamente a bloqueada. A
--   PERMISSAO e a trava, nao a lista de destinos.
--
--   motivo obrigatorio. Movimento manual e o que alguem vai querer entender
--   tres semanas depois olhando o historico. Sem motivo fica um salto
--   inexplicado na linha do tempo — e salto inexplicado e o que faz ninguem
--   confiar no historico inteiro.
--
--   mover para Enviado NAO cobra o custo de etiqueta. A caixa saiu por um
--   caminho que o ZYNTRA nao viu; afirmar que custou R$ 11,99 seria inventar
--   numero no fechamento do mes. Quem move ve esse aviso na tela.
--
-- O QUE ISTO NAO FAZ, e esta e a regra inteira: muda a ETAPA e mais nada.
-- Nao grava saida, nao cobra etiqueta, nao fecha conferencia, nao pede nota,
-- nao imprime.
--
-- NOTA: a versao de `alterar_etapa_manualmente` que ficou de pe e a da
-- migracao 20261026185008 — esta aqui deixava o sinal do guarda ligado ate o
-- fim da transacao.

-- --------------------------------------- 1. a permissao aparece na Equipe
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
     'Mover a caixa para qualquer etapa, furando o caminho normal da esteira. Exige motivo escrito, e o motivo fica no histórico da caixa.', 'perfil', 17)
  ) as t(chave, grupo, rotulo, descricao, onde, ordem)
  order by ordem;
$function$;

-- ------------------------------- 2. o guarda abre so para quem foi avisado
-- A trava das transicoes continua inteira para todo mundo. O que muda e uma
-- porta nomeada: `alterar_etapa_manualmente` liga um sinal de transacao, e o
-- guarda reconhece esse sinal. Sem ele, `pronto -> aberto` continua recusado.
create or replace function public.validar_transicao_etapa()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  permitido boolean := false;
begin
  if new.etapa = old.etapa then
    return new;
  end if;

  if coalesce(current_setting('zyntra.alteracao_manual', true), '') = '1' then
    permitido := true;
  elsif new.etapa in ('enviado', 'retido', 'entregue') then
    permitido := true;
  elsif old.etapa = 'retido' then
    permitido := new.etapa = old.etapa_anterior;
  else
    permitido := (old.etapa, new.etapa) in (
      ('aberto',   'faturado'),
      ('faturado', 'separar'),
      ('faturado', 'aberto'),
      ('separar',  'conferir'),
      ('separar',  'faturado'),
      ('conferir', 'pronto'),
      ('conferir', 'separar'),
      -- Bipe errado na porta se desfaz enquanto a saida nao fechou.
      ('enviado',  'pronto')
    );
  end if;

  if not permitido then
    raise exception
      'Transicao de etapa invalida: % -> % (pacote %)',
      old.etapa, new.etapa, old.id
      using errcode = 'check_violation';
  end if;

  if new.etapa = 'retido' and old.etapa <> 'retido' then
    new.etapa_anterior := old.etapa;
  elsif old.etapa = 'retido' then
    new.etapa_anterior := null;
  end if;

  new.etapa_desde := now();

  insert into public.eventos_pacote (pacote_id, tipo, de, para, por)
  values (old.id, 'etapa', old.etapa::text, new.etapa::text, auth.uid());

  return new;
end;
$function$;

-- ------------------------------------------------- 3. a porta, com motivo
create or replace function public.alterar_etapa_manualmente(
  p_pacote_id uuid,
  p_etapa text,
  p_motivo text
)
returns table (ok boolean, motivo text, de text, para text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_de text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_para public.etapa;
begin
  if not public.pode('alterar_etapa') then
    return query select false, 'sem_permissao', null::text, null::text; return;
  end if;

  if length(v_motivo) < 5 then
    return query select false, 'motivo_curto', null::text, null::text; return;
  end if;

  begin
    v_para := p_etapa::public.etapa;
  exception when others then
    return query select false, 'etapa_desconhecida', null::text, null::text; return;
  end;

  select pa.etapa::text into v_de from public.pacotes pa where pa.id = p_pacote_id;

  if v_de is null then
    return query select false, 'pacote_nao_encontrado', null::text, null::text; return;
  end if;

  if v_de = v_para::text then
    return query select false, 'ja_esta_nessa_etapa', v_de, v_de; return;
  end if;

  perform set_config('zyntra.alteracao_manual', '1', true);

  update public.pacotes set etapa = v_para where id = p_pacote_id;

  insert into public.eventos_pacote (pacote_id, tipo, de, para, detalhe, por)
  values (p_pacote_id, 'alteracao_manual', v_de, v_para::text,
          'Etapa alterada na mao. Motivo: ' || v_motivo, auth.uid());

  return query select true, 'ok', v_de, v_para::text;
end;
$function$;

revoke all on function public.alterar_etapa_manualmente(uuid, text, text)
  from public, anon;
grant execute on function public.alterar_etapa_manualmente(uuid, text, text)
  to authenticated;
