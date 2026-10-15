-- Entra ligado, e não emite nada.
--
-- `pedir_notas_ml` exige, por conta: emissão automática ligada, não pausada,
-- empresa emissora amarrada e faturador `ativo`. As quatro estão faltando
-- hoje, então o cron roda, não acha nada e volta. A infraestrutura fica de pé
-- com a emissão desligada, e quem liga é ela, uma conta por vez, na tela.
--
-- O minuto 3 do ciclo de cinco é depois de `varrer_pedidos_ml` (minuto 0) e
-- antes de `varrer_notas_ml` (minuto 2 do ciclo seguinte): o pedido entra, a
-- nota é pedida, a varredura seguinte traz a resposta e cura a linha.
--
-- `marcar_notas_sem_resposta` é faxina, não urgência: de dez em dez minutos,
-- e só mexe no que passou de meia hora.

select cron.schedule('pedir_notas_ml', '3-59/5 * * * *',
                     $$ select public.pedir_notas_ml(20) $$);

select cron.schedule('marcar_notas_sem_resposta', '7-59/10 * * * *',
                     $$ select public.marcar_notas_sem_resposta(30) $$);
