-- A ETIQUETA NUNCA SAIU. NENHUMA VEZ.
--
-- `public.impressoes` nao tem uma unica linha de tipo 'etiqueta' desde que o
-- sistema existe — so uma 'minuta' de teste de 22/10. Hoje a Daniele bipou
-- duas caixas, as duas fecharam, e o log da Edge Function devolveu 500 nas
-- duas.
--
-- A causa: `solicitar_impressao` comeca com `exige_perfil_ativo()`, que exige
-- `auth.uid()`. Quem a chama e a Edge Function `etiqueta`, que usa a CHAVE DE
-- SERVICO — e ali `auth.uid()` e nulo. A funcao levanta "Perfil inativo ou
-- inexistente" e o 500 chega na tela como "nao foi possivel imprimir".
--
-- Ficou um mes invisivel porque imprimir etiqueta dependia de um clique numa
-- tela que ninguem tinha usado. No minuto em que a etiqueta passou a sair no
-- bipe, apareceu na primeira caixa.
--
-- O conserto segue o costume da casa: o MIOLO vai para `privado`, sem
-- checagem de identidade, e cada porta publica faz a sua propria.
--
--   solicitar_impressao          -> pessoa na tela, como sempre
--   solicitar_impressao_servico  -> chave de servico, e so ela
--
-- A porta de servico NAO e mais frouxa: ela exige `p_operador_id` de um
-- perfil ativo. A Edge Function ja validou o JWT de quem bipou e conferiu que
-- o perfil esta ativo; aqui ela diz por quem agiu, e isso fica gravado na
-- impressao. Ninguem imprime anonimo por este caminho.

create or replace function privado.enfileirar_impressao(
  p_tipo public.documento_tipo,
  p_conteudo text,
  p_pacote_id uuid,
  p_lista_id uuid,
  p_estacao_id uuid,
  p_operador_id uuid,
  p_copias integer,
  p_motivo_reimpressao text
)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_impressora uuid;
  v_ja integer;
  v_reimpressao boolean := false;
begin
  if coalesce(trim(p_conteudo), '') = '' then
    return query select false, 'sem_conteudo', null::uuid; return;
  end if;

  -- O documento precisa saber de quem ele e.
  if p_tipo in ('etiqueta', 'danfe') and p_pacote_id is null then
    return query select false, 'pacote_nao_informado', null::uuid; return;
  end if;

  if p_tipo = 'lista_separacao' and p_lista_id is null then
    return query select false, 'lista_nao_informada', null::uuid; return;
  end if;

  if p_tipo in ('etiqueta', 'danfe') then
    if not exists (
      select 1 from public.conferencias c
      where c.pacote_id = p_pacote_id and c.situacao = 'concluida'
    ) then
      return query select false, 'conferencia_nao_concluida', null::uuid; return;
    end if;

    select count(*) into v_ja
    from public.impressoes im
    where im.pacote_id = p_pacote_id and im.tipo = p_tipo;

    v_reimpressao := v_ja > 0;

    if v_reimpressao and coalesce(trim(p_motivo_reimpressao), '') = '' then
      return query select false, 'motivo_reimpressao_obrigatorio', null::uuid; return;
    end if;
  end if;

  if p_estacao_id is null then
    return query select false, 'estacao_nao_informada', null::uuid; return;
  end if;

  v_impressora := public.impressora_da_estacao(p_estacao_id);

  if v_impressora is null then
    return query select false, 'estacao_sem_impressora', null::uuid; return;
  end if;

  if not exists (
    select 1 from public.impressoras_situacao s
    where s.id = v_impressora and s.agente_online
  ) then
    return query select false, 'agente_offline', null::uuid; return;
  end if;

  insert into public.impressoes
    (tipo, conteudo, copias, pacote_id, lista_id, impressora_id, operador_id,
     reimpressao, motivo_reimpressao)
  values
    (p_tipo, p_conteudo, greatest(coalesce(p_copias, 1), 1), p_pacote_id,
     p_lista_id, v_impressora, p_operador_id, v_reimpressao,
     nullif(trim(coalesce(p_motivo_reimpressao, '')), ''))
  returning id into v_id;

  return query select true, 'ok', v_id;
end;
$function$;

comment on function privado.enfileirar_impressao is
  'O miolo de enfileirar impressao, sem checar identidade. Quem checa e a '
  'porta publica: solicitar_impressao (pessoa) ou solicitar_impressao_servico '
  '(chave de servico).';

-- ------------------------------------------------- a porta da pessoa na tela
create or replace function public.solicitar_impressao(
  p_tipo public.documento_tipo,
  p_conteudo text,
  p_pacote_id uuid default null,
  p_lista_id uuid default null,
  p_estacao_id uuid default null,
  p_operador_id uuid default null,
  p_copias integer default 1,
  p_motivo_reimpressao text default null
)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform public.exige_perfil_ativo();

  return query select * from privado.enfileirar_impressao(
    p_tipo, p_conteudo, p_pacote_id, p_lista_id, p_estacao_id,
    coalesce(p_operador_id, auth.uid()), p_copias, p_motivo_reimpressao);
end;
$function$;

comment on function public.solicitar_impressao is
  'Enfileira um documento para a impressora da bancada. Exige pessoa logada e '
  'ativa; sem operador informado, quem pediu e quem esta logado.';

-- --------------------------------------------- a porta da chave de servico
create or replace function public.solicitar_impressao_servico(
  p_tipo public.documento_tipo,
  p_conteudo text,
  p_operador_id uuid,
  p_pacote_id uuid default null,
  p_lista_id uuid default null,
  p_estacao_id uuid default null,
  p_copias integer default 1,
  p_motivo_reimpressao text default null
)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Nao ha `auth.uid()` aqui, e e por isso que esta porta existe. O que ela
  -- cobra em troca e um operador NOMEADO e ativo: a impressao fica com dono,
  -- e um id inventado nao passa.
  if p_operador_id is null
     or not exists (
       select 1 from public.perfis pf where pf.id = p_operador_id and pf.ativo
     ) then
    return query select false, 'operador_nao_informado', null::uuid; return;
  end if;

  return query select * from privado.enfileirar_impressao(
    p_tipo, p_conteudo, p_pacote_id, p_lista_id, p_estacao_id,
    p_operador_id, p_copias, p_motivo_reimpressao);
end;
$function$;

comment on function public.solicitar_impressao_servico is
  'Mesma fila, para quem chama com a chave de servico (a Edge Function da '
  'etiqueta). Exige operador ativo nomeado, porque aqui nao existe auth.uid().';

revoke all on function public.solicitar_impressao_servico(
  public.documento_tipo, text, uuid, uuid, uuid, uuid, integer, text)
  from public, anon, authenticated;

grant execute on function public.solicitar_impressao_servico(
  public.documento_tipo, text, uuid, uuid, uuid, uuid, integer, text)
  to service_role;
