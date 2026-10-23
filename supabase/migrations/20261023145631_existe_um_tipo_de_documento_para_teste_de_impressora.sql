-- Um tipo proprio para a etiqueta de teste.
--
-- Nao reaproveito 'minuta': teste nao e documento de expedicao, e misturar os
-- dois sujaria qualquer contagem de minuta emitida. Um valor proprio tambem
-- deixa o teste visivel no historico da impressora como o que ele e.
--
-- Esta migracao faz SO isto. O Postgres nao deixa usar um valor de enum na
-- mesma transacao em que ele e criado, e a restricao e a funcao que vem a
-- seguir precisam escrever 'teste'::documento_tipo.
alter type public.documento_tipo add value if not exists 'teste';
