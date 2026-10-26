-- A varredura perguntava ao ML os pedidos criados nas ULTIMAS 2 HORAS, fixo,
-- para todas as contas. Isso tem dois problemas, e a Daniele achou os dois.
--
-- 1. CONTA NOVA. Ela conectou a SMARTDEPOT e perguntou: "nao quero que pedidos
--    antigos caiam". Por sorte nao caem — a janela de 2h ja cuida disso. Mas
--    e sorte: ela nao escolheu isso, e nao tinha onde escolher. A coluna
--    `contas.importar_desde` existia no banco desde o comeco e NENHUMA funcao
--    a lia. Campo morto.
--
-- 2. O BURACO. Se a varredura parar por mais de 2 horas — deploy, ML fora,
--    cron travado — os pedidos daquele intervalo NUNCA entram. Ninguem
--    pergunta por eles de novo, porque a janela sempre olha so as ultimas 2h
--    a partir de agora. E uma perda silenciosa de pedido, que e a pior
--    especie: ninguem descobre ate o cliente cobrar.
--
-- Agora sao duas datas, com papeis diferentes:
--
--   importar_desde  o CHAO, escolhido por gente. Nunca importar nada criado
--                   antes disto. Ao conectar, vira `now()` — conta nova nao
--                   traz historico. Editavel na tela.
--
--   varrido_ate     a MARCA D'AGUA, movida pela maquina. So avanca quando a
--                   varredura daquela conta termina sem erro. Enquanto ela
--                   estiver parada, a marca nao anda, e quando voltar ela
--                   pergunta desde onde parou. O buraco deixa de existir.
--
-- A marca avanca ate `inicio - 6 horas`, e nao ate o inicio. O motivo e o
-- filtro `order.status=paid` com `date_created.from`: um pedido CRIADO as 10h
-- e PAGO as 14h so aparece na busca depois de pago, e ai sua data de criacao
-- ja estaria atras de uma marca sem folga. Seis horas de sobreposicao e o
-- preco de nao perder venda paga com atraso.
--
-- E um teto de 7 dias para tras, para a primeira varredura de uma conta com
-- marca antiga nao tentar puxar meses de historico numa tacada.

alter table public.contas
  add column if not exists varrido_ate timestamptz;

comment on column public.contas.importar_desde is
  'O chao: nunca importar pedido criado antes disto. Escolhido por gente, e '
  'preenchido com now() ao conectar, para conta nova nao trazer historico.';

comment on column public.contas.varrido_ate is
  'A marca dagua da varredura, movida pela maquina. So avanca quando a '
  'varredura termina sem erro — e por isso que parada de uma hora nao vira '
  'pedido perdido.';

update public.contas
   set importar_desde = coalesce(importar_desde, conectada_em, criada_em),
       varrido_ate    = coalesce(varrido_ate, now() - interval '2 hours')
 where situacao = 'conectada';

-- NOTA: a aplicacao original desta migracao tambem reescreveu
-- `varrer_pedidos_ml` para usar as duas datas. A migracao seguinte
-- (20261026203142) reescreve a mesma funcao por inteiro, acrescentando a
-- pausa — entao o corpo dela mora la, e nao duplicado aqui. O estado final e
-- identico; so nao existe o passo intermediario, que ninguem precisa.
