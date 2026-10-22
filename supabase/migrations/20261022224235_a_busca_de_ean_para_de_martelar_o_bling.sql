-- Fui olhar porque uma rodada levou 26 segundos e achei quatro problemas,
-- todos da mesma família: ela pergunta demais ao Bling.
--
-- 1. SESSENTA chamadas HTTP SÍNCRONAS por rodada, de minuto em minuto. É uma
--    por segundo sustentada, disputando o mesmo limite por segundo que a fila
--    de baixa usa. E é o que explica os 26 segundos.
--
-- 2. SEM TRAVA DE SOBREPOSIÇÃO. Se uma rodada passar de 60 segundos — e com o
--    Bling lento ela passa — o cron começa outra por cima, as duas pegando os
--    mesmos SKUs e dobrando as chamadas. Quanto mais lento o Bling, mais o
--    ZYNTRA bate nele. Exatamente o contrário do certo.
--
-- 3. RECUSA NÃO SEGURA NADA. Quando o Bling responde 429, ela conta falha e
--    segue para o próximo — e como não marca o SKU como verificado, no minuto
--    seguinte tenta os MESMOS. Martela enquanto está sendo barrada. O 401 já
--    interrompia a rodada; o 429 passa a interromper também.
--
-- 4. E o pior, que só apareceu ao contar: 822 SKUs elegíveis e NENHUM "nunca
--    verificado". Ela já perguntou por todos, e eles voltam todo dia porque
--    o Bling não tem foto para 821 deles. São 822 chamadas por dia, para
--    sempre, pela mesma resposta vazia. Agora a espera cresce: 1 dia, 2, 3,
--    até 30. Foto que não existe hoje dificilmente existe amanhã, e quando
--    alguém cadastrar uma, ela aparece no máximo um mês depois.

alter table public.skus
  add column if not exists enriquecimento_tentativas integer not null default 0;

comment on column public.skus.enriquecimento_tentativas is
  'Quantas vezes ja perguntamos ao Bling por EAN/foto deste SKU sem resolver. '
  'Governa a espera ate a proxima pergunta: um dia por tentativa, teto de 30.';

create or replace function privado.buscar_eans(p_limite integer default 15)
returns table (verificados integer, encontrados integer, sem_ean integer, falhas integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token text; v_expira timestamptz;
  v_sku record; v_r extensions.http_response; v_d jsonb;
  v_gtin text; v_foto text; v_inseriu integer;
  v_ver integer := 0; v_enc integer := 0; v_sem integer := 0; v_fal integer := 0;
begin
  -- Trava de rodada. Sem ela, rodada lenta vira duas rodadas simultaneas
  -- pegando os mesmos SKUs. Solta sozinha no fim da transacao.
  if not pg_try_advisory_xact_lock(hashtext('zyntra.buscar_eans')) then
    return query select 0,0,0,0;
    return;
  end if;

  select c.access_token, c.expira_em into v_token, v_expira
  from privado.credenciais_erp c where c.id;

  if coalesce(v_token,'') = '' or (v_expira is not null and v_expira < now()) then
    return query select 0,0,0,0;
    return;
  end if;

  for v_sku in
    select s.id, s.erp_ref,
           not exists (select 1 from public.sku_codigos_barras b where b.sku_id = s.id) as falta_ean,
           coalesce(s.foto_url,'') = '' as falta_foto
    from public.skus s
    where s.ativo
      and coalesce(s.erp_ref,'') <> ''
      and (
        not exists (select 1 from public.sku_codigos_barras b where b.sku_id = s.id)
        or coalesce(s.foto_url,'') = ''
      )
      -- Espera crescente: um dia por tentativa, teto de 30. Sem isto sao 822
      -- chamadas por dia para sempre, pela mesma resposta vazia.
      and (
        s.ean_verificado_em is null
        or s.ean_verificado_em < now() - make_interval(
             days => least(greatest(coalesce(s.enriquecimento_tentativas, 0), 1), 30))
      )
    order by s.ean_verificado_em nulls first, s.codigo
    limit greatest(least(coalesce(p_limite, 15), 200), 1)
  loop
    begin
      select * into v_r from extensions.http((
        'GET', 'https://api.bling.com.br/Api/v3/produtos/' || v_sku.erp_ref,
        array[extensions.http_header('Accept','application/json'),
              extensions.http_header('Authorization','Bearer ' || v_token)],
        null, null)::extensions.http_request);
    exception when others then
      v_fal := v_fal + 1; continue;
    end;

    if v_r.status <> 200 then
      v_fal := v_fal + 1;
      -- 401: credencial morta, nao adianta continuar.
      -- 429: estamos sendo barrados por excesso — insistir piora.
      exit when v_r.status in (401, 429);
      continue;
    end if;

    v_ver := v_ver + 1;
    v_d := coalesce((v_r.content::jsonb)->'data','{}'::jsonb);

    update public.skus
       set ean_verificado_em = now(),
           enriquecimento_tentativas = coalesce(enriquecimento_tentativas, 0) + 1
     where id = v_sku.id;

    if v_sku.falta_foto then
      v_foto := btrim(coalesce(
        v_d->'midia'->'imagens'->'externas'->0->>'link',
        v_d->'midia'->'imagens'->'internas'->0->>'link',
        v_d->'midia'->'imagens'->'imagensURL'->0->>'link',
        v_d->>'imagemURL',
        ''
      ));

      if v_foto <> '' then
        update public.skus
           set foto_url = v_foto, atualizado_em = now()
         where id = v_sku.id and coalesce(foto_url,'') = '';
      end if;
    end if;

    if not v_sku.falta_ean then
      continue;
    end if;

    v_gtin := btrim(coalesce(v_d->>'gtin', ''));

    if v_gtin = '' then
      v_sem := v_sem + 1;
      continue;
    end if;

    insert into public.sku_codigos_barras (sku_id, codigo, tipo, principal)
    values (v_sku.id, v_gtin, 'ean', true)
    on conflict (sku_id, codigo) do nothing;

    get diagnostics v_inseriu = row_count;
    if v_inseriu > 0 then v_enc := v_enc + 1; end if;
  end loop;

  return query select v_ver, v_enc, v_sem, v_fal;
end;
$function$;

comment on function privado.buscar_eans is
  'Pergunta ao Bling o EAN e a foto dos SKUs que ainda nao tem. Uma rodada por '
  'vez (trava), 15 por rodada, para na primeira recusa por excesso, e espaca a '
  'pergunta em um dia por tentativa ate o teto de 30.';

-- De 60 por minuto para 15 por minuto.
select cron.unschedule('zyntra-ean-do-bling');
select cron.schedule('zyntra-ean-do-bling', '* * * * *',
                     $$ select privado.buscar_eans(15) $$);
