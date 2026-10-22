-- `coletar_respostas_baixa` tratava QUALQUER resposta fora do 2xx como erro
-- definitivo. Inclusive 429, que é o limite de requisições por segundo do
-- Bling — e eu tomei um 429 testando, com três chamadas seguidas.
--
-- O estrago: a baixa sai de `pendente`, e `drenar_baixas` só pega pendentes.
-- Então um limite de requisição matava a baixa para sempre. Numa hora
-- movimentada, com várias vendas entrando juntas, isso vira uma peça que nunca
-- desce do estoque e ninguém percebe. É pior que não ter automação nenhuma,
-- porque ela seria confiável o bastante para ninguém conferir.
--
-- Agora a resposta é lida em três grupos:
--
--   2xx                      -> enviada, acabou
--   429, 5xx, sem resposta   -> VOLTA para a fila. O Bling recusou por estar
--                               ocupado ou fora do ar, não porque o pedido
--                               estava errado. A espera crescente que já
--                               existe cuida do resto.
--   outros 4xx               -> erro de verdade. Produto que não existe,
--                               depósito errado, corpo inválido. Repetir isso
--                               mil vezes dá o mesmo resultado.
--
-- Com teto: depois de 10 tentativas, até o temporário vira erro. Sem isso,
-- Bling fora do ar por dias deixaria a baixa girando invisível.

create or replace function public.coletar_respostas_baixa()
returns table (resolvidos integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  update public.baixas_estoque_itens i
     set situacao = case
           when r.status_code between 200 and 299 then 'enviada'
           when (r.status_code is null or r.status_code = 429 or r.status_code >= 500)
                and b.tentativas < 10 then 'pendente'
           else 'erro'
         end,
         -- Volta para a fila sem request_id: a proxima rodada manda de novo.
         request_id = case
           when r.status_code between 200 and 299 then i.request_id
           when (r.status_code is null or r.status_code = 429 or r.status_code >= 500)
                and b.tentativas < 10 then null
           else i.request_id
         end,
         enviada_em = case
           when r.status_code between 200 and 299 then now() else null end,
         erro = case
           when r.status_code between 200 and 299 then null
           when (r.status_code is null or r.status_code = 429 or r.status_code >= 500)
                and b.tentativas < 10 then
             'Bling recusou por agora (' || coalesce(r.status_code::text, 'sem resposta')
             || '). Vai tentar de novo.'
           else 'Bling respondeu ' || coalesce(r.status_code::text, 'sem resposta')
                || ': ' || left(coalesce(r.content, ''), 300)
         end
    from net._http_response r, public.baixas_estoque b
   where r.id = i.request_id
     and b.id = i.baixa_id
     and i.situacao = 'enviando';

  get diagnostics v_n = row_count;

  -- Baixa completa: toda peca saiu.
  update public.baixas_estoque b
     set situacao = 'enviada', enviada_em = now(), erro = null
   where b.situacao = 'pendente'
     and exists (select 1 from public.baixas_estoque_itens i where i.baixa_id = b.id)
     and not exists (
       select 1 from public.baixas_estoque_itens i
       where i.baixa_id = b.id and i.situacao <> 'enviada'
     );

  -- Alguma peca falhou de verdade: a baixa inteira fica em erro, para alguem
  -- olhar. Item que voltou para a fila NAO conta aqui — ele ainda vai tentar.
  update public.baixas_estoque b
     set situacao = 'erro',
         erro = (
           select string_agg(distinct i.erro, ' | ')
           from public.baixas_estoque_itens i
           where i.baixa_id = b.id and i.situacao = 'erro'
         )
   where b.situacao = 'pendente'
     and exists (
       select 1 from public.baixas_estoque_itens i
       where i.baixa_id = b.id and i.situacao = 'erro'
     );

  return query select v_n;
end;
$$;

comment on function public.coletar_respostas_baixa is
  'Le as respostas do Bling. 2xx encerra; 429/5xx/sem resposta volta para a '
  'fila (ate 10 tentativas); outros 4xx viram erro para alguem olhar.';
