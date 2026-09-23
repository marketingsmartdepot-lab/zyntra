-- Cliente HTTP sincrono, so para renovar token.
--
-- Sincrono de proposito, e nao `pg_net`: refresh token e de uso unico. Com
-- chamada assincrona, uma resposta perdida significa token queimado e conta
-- reconectada na mao. Sincrono, gastar o refresh e gravar o novo acontecem na
-- mesma transacao — ou as duas coisas, ou nenhuma.
--
-- Sao poucas chamadas — treze contas, e so perto de vencer — entao bloquear
-- nao pesa. Para volume (as baixas de estoque) continua valendo `pg_net`.

create extension if not exists http with schema extensions;
