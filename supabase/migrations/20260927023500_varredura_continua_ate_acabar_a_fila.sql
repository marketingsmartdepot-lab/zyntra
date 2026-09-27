-- A varredura pegava só o primeiro bloco de cada conta. Em dia de movimento,
-- uma conta com 40 pedidos novos entregaria 15 e deixaria 25 para a próxima
-- volta — e a fila só cresceria. Agora ela continua enquanto o ML disser que
-- há mais, com teto, para uma conta cheia não segurar as outras 27.
create or replace function public.varrer_pedidos_ml(
  p_janela interval default interval '2 hours',
  p_quantos integer default 15,
  p_paginas integer default 6
) returns table(contas integer, pedidos integer, pacotes integer, falhas integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_c record;
  v_r record;
  v_off integer;
  v_pag integer;
  n_contas integer := 0; n_ped integer := 0; n_pac integer := 0; n_falhas integer := 0;
begin
  for v_c in
    select ct.id, ct.apelido
    from public.contas ct
    join public.canais ca on ca.id = ct.canal_id
    where ca.slug = 'mercado_livre'
      and ct.situacao = 'conectada'
    order by ct.criada_em
  loop
    n_contas := n_contas + 1;
    v_off := 0;
    v_pag := 0;

    -- Uma conta que falha não derruba as outras: o erro fica na conta, e as
    -- 27 restantes continuam. Sem isso, um token revogado numa loja pararia o
    -- galpão inteiro.
    begin
      loop
        select * into v_r from privado.sincronizar_conta_ml(
          v_c.id, now() - coalesce(p_janela, interval '2 hours'), v_off, p_quantos);

        v_pag := v_pag + 1;

        if not v_r.ok then
          n_falhas := n_falhas + 1;
          update public.contas c
             set ultimo_erro = 'Varredura: ' || coalesce(v_r.motivo, '?')
                               || coalesce(' — ' || v_r.detalhe, ''),
                 atualizado_em = now()
           where c.id = v_c.id;
          exit;
        end if;

        n_ped := n_ped + coalesce(v_r.pedidos, 0);
        n_pac := n_pac + coalesce(v_r.pacotes, 0);

        exit when not coalesce(v_r.tem_mais, false)
               or v_pag >= greatest(coalesce(p_paginas, 6), 1);

        v_off := v_r.proximo_offset;
      end loop;

      -- Deu certo: o erro anterior desta conta não vale mais.
      if v_r.ok then
        update public.contas c
           set ultimo_erro = null, atualizado_em = now()
         where c.id = v_c.id and c.ultimo_erro like 'Varredura%';
      end if;

    exception when others then
      n_falhas := n_falhas + 1;
      update public.contas c
         set ultimo_erro = 'Varredura falhou: ' || sqlerrm, atualizado_em = now()
       where c.id = v_c.id;
    end;
  end loop;

  return query select n_contas, n_ped, n_pac, n_falhas;
end;
$$;

revoke all on function public.varrer_pedidos_ml(interval, integer, integer) from public, anon, authenticated;
drop function if exists public.varrer_pedidos_ml(interval, integer);

-- De 5 em 5 minutos. O pedido do Mercado Livre não tem pressa de segundos: o
-- que não pode é depender de alguém lembrar de apertar um botão.
select cron.schedule(
  'zyntra-pedidos-ml',
  '*/5 * * * *',
  $cron$ select public.varrer_pedidos_ml() $cron$
);
