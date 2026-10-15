-- As duas pontas da nota calculavam a chave de idempotência diferente, e a
-- coluna é UNIQUE:
--
--   solicitar_nota        -> chave_da_nota()        -> "<conta>:<pedido>"
--   privado.buscar_nota_do_pedido (varredura do ML) -> "ml:<conta>:<pedido>"
--
-- Hoje isso é invisível porque `solicitar_nota` nunca rodou — as 97 notas da
-- base vieram todas da varredura, todas com o prefixo `ml:`. No primeiro dia
-- de emissão automática viraria DUAS linhas por pedido: a nossa presa em
-- `solicitada` para sempre, e a do ML `autorizada`. A presa não apareceria em
-- `aberto_por_causa` (que só olha `rejeitada`), então seria um pedido que o ML
-- talvez tenha faturado e ninguém saberia.
--
-- Alinhando o prefixo, o `on conflict (chave_idempotencia) do update set
-- situacao = excluded.situacao` da varredura cai na NOSSA linha e a cura de
-- `solicitada` para `autorizada` — e chama diagnosticar_pacote em seguida. A
-- cura passa a ser estrutural em vez de remendo.
--
-- Nada a migrar: nenhuma nota existente usa a chave sem prefixo.

create or replace function public.chave_da_nota(p_pedido_id uuid)
returns text
language sql
stable security definer
set search_path = ''
as $$
  select 'ml:' || p.conta_id::text || ':' || p.ref_externa
  from public.pedidos p
  where p.id = p_pedido_id;
$$;

comment on function public.chave_da_nota is
  'Chave de idempotencia da nota de um pedido. MESMO formato que '
  'privado.buscar_nota_do_pedido usa, para que a varredura do ML atualize a '
  'linha que solicitar_nota criou em vez de criar uma segunda.';
