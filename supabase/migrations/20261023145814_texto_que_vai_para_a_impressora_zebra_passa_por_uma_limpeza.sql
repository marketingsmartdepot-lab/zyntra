-- Escrevi `imprimir_teste` chamando `public.sem_acento`, que nao existe. O
-- Postgres aceita: corpo de plpgsql nao resolve chamadas na criacao, so na
-- hora de rodar. Sem isto a etiqueta de teste falharia no galpao com
-- "function does not exist" — erro que nao aponta para nada util.
--
-- E a limpeza precisa ir alem de acento. Dois caracteres sao COMANDO para a
-- Zebra: `^` abre instrucao e `~` abre instrucao de controle. Uma bancada
-- chamada "Bancada ^ 2" nao sairia torta — ela viraria ZPL invalido, e o que
-- sai de impressora com ZPL invalido e papel em branco ou lixo em metros.
--
-- Acento sai porque o agente grava o arquivo em latin1 e a impressora
-- interpreta com a pagina de codigo dela, que varia por modelo. Tirar na
-- origem e mais seguro que acertar a combinacao em cada bancada.

create or replace function public.texto_para_zpl(p_texto text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select translate(
    translate(
      coalesce(p_texto, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
    ),
    -- `to` vazio apaga: estes dois nao tem substituto seguro.
    '^~', ''
  );
$function$;

comment on function public.texto_para_zpl is
  'Prepara texto para entrar num comando ZPL: tira acento (o agente grava em '
  'latin1) e tira ^ e ~, que a Zebra le como inicio de comando.';

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

  -- Sem ^PW e sem ^LL: a impressora usa a largura que ela ja tem configurada,
  -- e assim o teste serve em etiqueta de qualquer tamanho.
  v_zpl :=
    '^XA' || E'\n' ||
    '^CI0^LH0,0' || E'\n' ||
    '^FO16,16^A0N,30,30^FDZYNTRA - TESTE^FS' || E'\n' ||
    '^FO16,54^A0N,22,22^FD' || public.texto_para_zpl(v_i.estacao) || '^FS' || E'\n' ||
    '^FO16,82^A0N,22,22^FD' || public.texto_para_zpl(left(v_i.nome, 34)) || '^FS' || E'\n' ||
    '^FO16,110^A0N,22,22^FD' ||
      to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') ||
      '^FS' || E'\n' ||
    '^FO16,138^A0N,22,22^FD' ||
      public.texto_para_zpl(left(coalesce(v_quem, 'sem nome'), 34)) || '^FS' || E'\n' ||
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
