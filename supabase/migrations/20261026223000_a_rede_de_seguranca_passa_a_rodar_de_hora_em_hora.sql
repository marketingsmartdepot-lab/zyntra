-- A Daniele achou um pedido entregue parado em Separar e mandou consertar o
-- atraso. Medi antes de mexer, e a medicao mudou o conserto.
--
-- O ATRASO DELA ERA HISTORIA. Naquele pedido o ML despachou em 22/10 11:42 e
-- o ZYNTRA so viu em 23/10 02:31 — 15 horas. Mas a causa foi a fila de avisos
-- sem leitor, que eu consertei em 23/10 02:52. Nao e o comportamento de hoje.
--
-- HOJE o caminho feliz esta rapido. Medido contra as datas do proprio ML, em
-- 8 caixas entregues nos ultimos 3 dias:
--
--   atraso medio   58 segundos
--   pior caso      4,5 minutos
--
-- E a fila esta saudavel: 0 parados, 88 avisos na ultima hora, 31 segundos
-- medios para processar.
--
-- ENTAO O QUE SOBRA E O CAMINHO INFELIZ, e e nele que eu mexo: quando um
-- aviso do ML se perde — e eles se perdem — a unica rede de seguranca e esta
-- varredura, que rodava UMA VEZ POR DIA, as 01h20. Nesse caso o atraso nao e
-- de um minuto: e de ate 24 horas, e a esteira mente o dia inteiro.
--
-- De hora em hora, o pior caso cai de 24 horas para 1. E o custo e miudo: ela
-- so olha pacote que ainda nao chegou, e hoje sao 16. Com as 28 contas e o
-- galpao cheio seriam algumas centenas de chamadas por hora — longe do limite
-- do ML, e ela ja para sozinha se levar 429.
--
-- Mantenho o minuto 20 para nao cair junto com as varreduras de 5 em 5
-- minutos, que acontecem nos minutos 0-4 de cada bloco.

select cron.unschedule('zyntra-reconciliar');

select cron.schedule('zyntra-reconciliar', '20 * * * *',
                     $$ select public.reconciliar_envios_ml(300) $$);
