-- `dropped_off` e PASSAGEIRO, e eu tratei como se fosse o estado final do
-- despacho. Horas depois do drop-off o ML move a caixa para
-- `in_packing_list` (a agencia agrupou num manifesto) e depois para `in_hub`
-- (chegou no centro do ML) — e os TRES ficam com status `ready_to_ship`.
--
-- Confirmado no historico de duas caixas de hoje, nao por suposicao:
--
--   48331046958: printed 08:10 -> dropped_off 16:42 -> in_hub        (date_shipped null)
--   48290238722: dropped_off 17:31 -> in_packing_list
--
-- O risco disso nao e cosmetico. Se o aviso do webhook do momento
-- `dropped_off` se perder, a varredura diaria olha a caixa, ve `in_hub`, nao
-- reconhece, e deixa em Pronto para sempre. E exatamente o defeito que
-- consertei hoje de manha — a caixa despachada que a esteira jura estar aqui —
-- so que agora disfarcado num substatus seguinte.
--
-- Por que lista explicita e nao "tudo que nao e printed": invertendo, um
-- substatus novo que signifique "ainda esta aqui" tiraria caixa do galpao
-- sozinho. Errar deixando a caixa em Pronto custa uma linha a mais numa tela;
-- errar mandando para Enviado esconde trabalho de verdade. A lista cresce
-- quando o dado mostrar, e a tela passa a mostrar substatus desconhecido
-- justamente para o dado aparecer rapido.

create or replace function public.envio_saiu_do_galpao(
  p_status text, p_substatus text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(p_status, '') in ('shipped', 'delivered')
      -- A cadeia da agencia, inteira. Os tres mantem status `ready_to_ship`,
      -- e nos tres a caixa ja nao esta no galpao:
      --   dropped_off      deixada na agencia
      --   in_packing_list  a agencia agrupou num manifesto
      --   in_hub           chegou no centro do ML
      or coalesce(p_substatus, '') in (
           'dropped_off', 'in_packing_list', 'in_hub');
$function$;

comment on function public.envio_saiu_do_galpao is
  'A caixa saiu do galpao? Olha status E substatus: a cadeia da agencia fica '
  'em ready_to_ship do drop-off ate o hub, e so o substatus conta a verdade. '
  'Lista explicita de proposito — ver o comentario da migracao 20261023 sobre '
  'por que nao inverter a regra.';
