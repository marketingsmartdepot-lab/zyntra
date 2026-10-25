-- O agente vai deixar de ser um despejo de log e virar uma tela de status.
-- Para isso ele precisa de uma coisa que nunca soube: QUAL BANCADA ele e.
--
-- Ele conhece as impressoras do Windows porque pergunta ao sistema
-- operacional. Mas "esta impressora e a termica da bancada Daniele Teste" e
-- decisao que mora no ZYNTRA, numa tela, e o agente so recebia o nome da
-- impressora dentro de cada trabalho.
--
-- Isso importa com 28 bancadas: quem chegar numa maquina e abrir a janela
-- precisa saber de qual bancada aquele computador e, sem ir ao ZYNTRA
-- conferir. E quando a etiqueta sai na bancada errada, e a primeira coisa que
-- alguem vai querer olhar.
--
-- Leitura pura, autenticada pela credencial da maquina — a mesma que ja
-- autentica a fila de trabalhos.

create or replace function public.agente_situacao(p_token text)
returns table (
  ok boolean,
  motivo text,
  maquina text,
  impressoras jsonb,
  na_fila integer
)
language plpgsql
security definer
set search_path to ''
as $function$
declare v_disp uuid;
begin
  v_disp := privado.dispositivo_da_credencial(p_token);

  if v_disp is null then
    return query select false, 'credencial_invalida', null::text, null::jsonb, 0;
    return;
  end if;

  update privado.dispositivos d set ultimo_contato_em = now() where d.id = v_disp;

  return query
  select
    true,
    'ok',
    (select d.nome_maquina from privado.dispositivos d where d.id = v_disp),
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'nome',      i.nome_no_sistema,
                'linguagem', i.linguagem,
                'bancada',   e.nome,
                'ativa',     i.ativa,
                'copias',    i.copias)
              order by i.ativa desc, i.nome_no_sistema)
         from public.impressoras i
         left join public.estacoes e on e.id = i.estacao_id
        where i.dispositivo_id = v_disp),
      '[]'::jsonb),
    coalesce(
      (select count(*)::integer
         from public.impressoes im
         join public.impressoras i on i.id = im.impressora_id
        where i.dispositivo_id = v_disp and im.situacao = 'pendente'),
      0);
end;
$function$;

comment on function public.agente_situacao is
  'O que o agente mostra na propria janela: nome da maquina, impressoras com '
  'bancada e linguagem, e quantos trabalhos esperam. Leitura, autenticada '
  'pela credencial da maquina.';

revoke all on function public.agente_situacao(text) from public, authenticated;
grant execute on function public.agente_situacao(text) to anon;
