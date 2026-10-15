-- Os outros nove jobs se chamam `zyntra-<coisa>-<verbo>`. Estes dois nasceram
-- com o nome da função, e numa lista de onze a inconsistência custa atenção.

select cron.unschedule('pedir_notas_ml');
select cron.unschedule('marcar_notas_sem_resposta');

select cron.schedule('zyntra-notas-pedir', '3-59/5 * * * *',
                     $$ select public.pedir_notas_ml(20) $$);

select cron.schedule('zyntra-notas-sem-resposta', '7-59/10 * * * *',
                     $$ select public.marcar_notas_sem_resposta(30) $$);
