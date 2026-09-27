-- Eu estava mostrando um substituto no lugar do prazo.
--
-- `shipping_option.buffering.date` é quando o ML libera a etiqueta, e
-- `estimated_handling_limit` não vem nesta conta. Nenhum dos dois é o prazo de
-- despacho. Ela viu "sem prazo do canal" numa caixa que tem prazo e cobrou —
-- com razão: prazo aproximado num galpão é pior que prazo nenhum, porque
-- alguém confia nele.
--
-- O prazo exato tem endereço próprio: GET /shipments/{id}/sla devolve
-- `expected_date` (o limite que o ML crava) e `status` (on_time / delayed),
-- que é a mesma informação que a Lexos mostra como "Status Envio".

alter table public.envios
  add column if not exists sla_situacao text,
  add column if not exists sla_atualizado_em timestamptz;

comment on column public.envios.sla_situacao is
  'Como o ML vê o prazo deste envio: on_time, delayed. Vem de /shipments/{id}/sla.';

create or replace function privado.buscar_sla_do_envio(p_envio_id uuid)
returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_e record;
  v_token text;
  v_r extensions.http_response;
  v_j jsonb;
  v_data timestamptz;
begin
  select e.id, e.ref_externa, e.conta_id into v_e
  from public.envios e where e.id = p_envio_id;

  if not found or coalesce(v_e.ref_externa, '') = '' then
    return query select false, 'envio_invalido'; return;
  end if;

  select t.token into v_token from privado.token_ml(v_e.conta_id) t;
  if coalesce(v_token, '') = '' then
    return query select false, 'sem_conexao'; return;
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '4000');
    select * into v_r from extensions.http((
      'GET',
      'https://api.mercadolibre.com/shipments/' || v_e.ref_externa || '/sla',
      array[
        extensions.http_header('Accept', 'application/json'),
        extensions.http_header('Authorization', 'Bearer ' || v_token)
      ],
      null, null
    )::extensions.http_request);
  exception when others then
    return query select false, 'rede'; return;
  end;

  if v_r.status < 200 or v_r.status > 299 then
    -- Marca a tentativa para a varredura não insistir no mesmo envio sem
    -- parar. Envio sem SLA existe: Full, por exemplo.
    update public.envios e set sla_atualizado_em = now() where e.id = p_envio_id;
    return query select false,
      case when v_r.status = 404 then 'sem_sla' else 'recusado' end;
    return;
  end if;

  v_j := v_r.content::jsonb;
  v_data := nullif(v_j->>'expected_date', '')::timestamptz;

  update public.envios e
     set limite_envio_em = coalesce(v_data, e.limite_envio_em),
         limite_origem = case when v_data is not null
                              then 'prazo de despacho do ML'
                              else e.limite_origem end,
         sla_situacao = nullif(v_j->>'status', ''),
         sla_atualizado_em = now(),
         atualizado_em = now()
   where e.id = p_envio_id;

  return query select true, 'ok';
end;
$$;

/**
 * A varredura do prazo. O ML recalcula o SLA — um envio que estava no prazo
 * pode atrasar — então não basta buscar uma vez.
 *
 * Primeiro os que nunca tiveram prazo, depois os mais velhos. Assim uma caixa
 * nova nunca fica sem prazo esperando a vez de uma antiga.
 */
create or replace function public.varrer_slas_ml(
  p_limite integer default 40,
  p_idade interval default interval '3 hours'
) returns table(consultados integer, atualizados integer, sem_sla integer, falhas integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_e record;
  v_r record;
  n_con integer := 0; n_at integer := 0; n_sem integer := 0; n_fal integer := 0;
begin
  for v_e in
    select e.id
    from public.envios e
    join public.contas ct on ct.id = e.conta_id
    join public.canais ca on ca.id = ct.canal_id
    join public.pacotes pa on pa.envio_id = e.id
    where ca.slug = 'mercado_livre'
      and ct.situacao = 'conectada'
      and pa.etapa not in ('pronto', 'encerrado')
      and (e.sla_atualizado_em is null
           or e.sla_atualizado_em < now() - coalesce(p_idade, interval '3 hours'))
    order by e.sla_atualizado_em nulls first
    limit greatest(coalesce(p_limite, 40), 1)
  loop
    n_con := n_con + 1;
    begin
      select * into v_r from privado.buscar_sla_do_envio(v_e.id);
      if v_r.ok then n_at := n_at + 1;
      elsif v_r.motivo = 'sem_sla' then n_sem := n_sem + 1;
      else n_fal := n_fal + 1;
      end if;
    exception when others then
      n_fal := n_fal + 1;
    end;
  end loop;

  return query select n_con, n_at, n_sem, n_fal;
end;
$$;

revoke all on function public.varrer_slas_ml(integer, interval) from public, anon, authenticated;

-- Deslocado dos outros dois para não disputarem a mesma janela.
select cron.schedule(
  'zyntra-prazos-ml',
  '4-59/5 * * * *',
  $cron$ select public.varrer_slas_ml() $cron$
);
