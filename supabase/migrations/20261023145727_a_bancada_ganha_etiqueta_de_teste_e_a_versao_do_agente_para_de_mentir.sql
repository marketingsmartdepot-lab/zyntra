-- Duas coisas que a instalacao da primeira bancada mostrou faltando.
--
-- 1. NAO HAVIA COMO TESTAR A IMPRESSORA.
--
-- Para provar que a termica imprime era preciso empurrar um pedido real pela
-- esteira inteira: lista, separacao, conferencia fechada, e so entao a aba
-- Pronto oferece a etiqueta. Numa bancada nova isso e caro e confuso — se nao
-- sair papel, o erro pode estar em qualquer um dos seis passos.
--
-- 2. A VERSAO DO AGENTE ERA GRAVADA UMA VEZ E NUNCA MAIS.
--
-- `registrar_dispositivo` e a unica que recebia a versao, e ela so roda no
-- primeiro login da maquina. Hoje aconteceu exatamente o que isso causa: a
-- bancada rodou o agente 2.1, o agente achou a credencial salva, pulou o
-- registro e foi trabalhar — e a tela seguiu dizendo "agente 2.0", do dia
-- anterior. Com 28 bancadas, esse e o campo que diria qual esta com build
-- velho, e ele mentiria em todas.
--
-- O conserto e por onde o agente passa SEMPRE: ele publica a lista de
-- impressoras a cada vez que sobe.

-- ---------------------------------------------------------------- restricao
-- 'teste' nao tem pacote nem lista: ele nao e de pedido nenhum.
alter table public.impressoes drop constraint impressoes_check;

alter table public.impressoes add constraint impressoes_check check (
     (tipo in ('etiqueta', 'danfe') and pacote_id is not null)
  or (tipo = 'lista_separacao'      and lista_id  is not null)
  or (tipo = 'minuta')
  or (tipo = 'teste')
);

-- ------------------------------------------------------- versao a cada subida
-- A assinatura antiga sai de cena: deixar as duas faria o PostgREST nao saber
-- qual chamar. O agente que esta no galpao manda dois argumentos, e continua
-- funcionando porque o terceiro tem padrao.
drop function if exists public.publicar_impressoras(text, jsonb);

create or replace function public.publicar_impressoras(
  p_token text,
  p_impressoras jsonb,
  p_versao text default null
)
returns table (ok boolean, motivo text, quantas integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare v_disp uuid; v_n integer := 0;
begin
  v_disp := privado.dispositivo_da_credencial(p_token);
  if v_disp is null then
    return query select false, 'credencial_invalida', 0; return;
  end if;

  -- A versao chega aqui toda vez que o agente sobe. `coalesce` para um agente
  -- antigo, que nao manda nada, nao apagar o que ja esta gravado.
  update privado.dispositivos
     set ultimo_contato_em = now(),
         versao_agente = coalesce(nullif(btrim(p_versao), ''), versao_agente)
   where id = v_disp;

  insert into public.impressoras (dispositivo_id, nome, nome_no_sistema, vista_em)
  select v_disp, btrim(x->>'nome'), btrim(x->>'nome'), now()
  from jsonb_array_elements(coalesce(p_impressoras, '[]'::jsonb)) x
  where btrim(coalesce(x->>'nome','')) <> ''
  -- A condicao do indice parcial precisa aparecer aqui tambem.
  on conflict (dispositivo_id, lower(btrim(nome_no_sistema)))
    where dispositivo_id is not null
  do update set vista_em = now();

  get diagnostics v_n = row_count;
  return query select true, 'ok', v_n;
end;
$function$;

comment on function public.publicar_impressoras is
  'O agente publica suas impressoras ao subir. E por aqui que a versao dele e '
  'atualizada: registrar_dispositivo so roda no primeiro login da maquina.';

-- ------------------------------------------------------- etiqueta de teste
-- NOTA: a versao desta funcao que ficou de pe e a da migracao seguinte. Esta
-- aqui chamava `public.sem_acento`, que nunca existiu — plpgsql nao resolve
-- chamadas na criacao, so na hora de rodar, e por isso o banco aceitou.
create or replace function public.imprimir_teste(p_impressora uuid)
returns table (ok boolean, motivo text, impressao_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_i record;
  v_quem text;
  v_zpl text;
  v_id uuid;
begin
  if not public.pode('mexer_integracao') then
    return query select false, 'sem_permissao', null::uuid; return;
  end if;

  select s.id, s.nome, s.linguagem, s.ativa, s.agente_online,
         coalesce(s.estacao, 'sem bancada') as estacao
    into v_i
  from public.impressoras_situacao s
  where s.id = p_impressora;

  if not found then
    return query select false, 'impressora_nao_encontrada', null::uuid; return;
  end if;

  if not v_i.ativa then
    return query select false, 'impressora_inativa', null::uuid; return;
  end if;

  -- Teste existe para a termica. Um teste em PDF exigiria gerar um PDF valido
  -- aqui dentro, e PDF torto na impressora sai como dezenas de paginas de
  -- lixo — justamente o que esta funcao deveria evitar.
  if coalesce(v_i.linguagem, 'zpl') <> 'zpl' then
    return query select false, 'teste_so_em_zpl', null::uuid; return;
  end if;

  if not v_i.agente_online then
    return query select false, 'agente_offline', null::uuid; return;
  end if;

  select p.nome into v_quem from public.perfis p where p.id = auth.uid();

  v_zpl :=
    '^XA' || E'\n' ||
    '^CI0^LH0,0' || E'\n' ||
    '^FO16,16^A0N,30,30^FDZYNTRA - TESTE^FS' || E'\n' ||
    '^FO16,54^A0N,22,22^FD' || public.sem_acento(v_i.estacao) || '^FS' || E'\n' ||
    '^FO16,82^A0N,22,22^FD' || public.sem_acento(left(v_i.nome, 34)) || '^FS' || E'\n' ||
    '^FO16,110^A0N,22,22^FD' ||
      to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') ||
      '^FS' || E'\n' ||
    '^FO16,138^A0N,22,22^FD' ||
      public.sem_acento(left(coalesce(v_quem, 'sem nome'), 34)) || '^FS' || E'\n' ||
    -- O codigo de barras tambem testa o coletor: da para bipar esta etiqueta.
    '^FO16,172^BY2,3,46^BCN,46,N,N,N^FDZYNTRATESTE^FS' || E'\n' ||
    '^XZ';

  insert into public.impressoes (tipo, conteudo, copias, impressora_id, operador_id)
  values ('teste', v_zpl, 1, p_impressora, auth.uid())
  returning id into v_id;

  return query select true, 'ok', v_id;
end;
$function$;

comment on function public.imprimir_teste is
  'Manda uma etiqueta de teste para a impressora escolhida, sem envolver '
  'pedido nenhum. E o jeito de fechar a configuracao de uma bancada nova.';

revoke all on function public.imprimir_teste(uuid) from public, anon;
grant execute on function public.imprimir_teste(uuid) to authenticated;
