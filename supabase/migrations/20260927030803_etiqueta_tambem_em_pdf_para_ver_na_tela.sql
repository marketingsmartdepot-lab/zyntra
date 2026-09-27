-- Quem confere numa máquina sem impressora precisa ver a etiqueta na tela.
--
-- O ZPL é para a Zebra: é texto de comando, ninguém lê. O que se lê é o PDF,
-- e o ML entrega os dois pelo mesmo endereço, mudando só o formato. Vêm
-- juntos, na mesma ida — buscar o PDF depois exigiria o token do ML do lado
-- do navegador, que é onde ele não pode estar.

alter table public.envios
  add column if not exists etiqueta_pdf text;

comment on column public.envios.etiqueta_pdf is
  'A etiqueta em PDF, em base64, para ver na tela. O ZPL é o que vai para a '
  'impressora térmica; este é o que uma pessoa lê.';

create or replace function public.coletar_etiquetas_ml()
returns table(guardadas integer, falhas integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_r record;
  n_ok integer := 0; n_erro integer := 0;
begin
  for v_r in
    select e.id as envio_id, r.status_code, r.content
    from public.envios e
    join net._http_response r on r.id = e.etiqueta_request_id
    where e.etiqueta_conteudo is null
      and e.etiqueta_request_id is not null
  loop
    if v_r.status_code between 200 and 299
       and coalesce((v_r.content::jsonb)->>'conteudo', '') <> '' then

      update public.envios e
         set etiqueta_conteudo = (v_r.content::jsonb)->>'conteudo',
             etiqueta_formato = coalesce((v_r.content::jsonb)->>'formato', 'zpl'),
             -- O PDF é conforto: se não veio, a etiqueta ainda imprime.
             etiqueta_pdf = nullif((v_r.content::jsonb)->>'pdf', ''),
             etiqueta_obtida_em = now(),
             etiqueta_request_id = null,
             etiqueta_erro = null,
             atualizado_em = now()
       where e.id = v_r.envio_id;

      n_ok := n_ok + 1;
    else
      update public.envios e
         set etiqueta_request_id = null,
             etiqueta_erro = 'ZYNTRA respondeu ' || coalesce(v_r.status_code::text, '?')
                             || ': ' || left(coalesce(v_r.content, ''), 200)
       where e.id = v_r.envio_id;

      n_erro := n_erro + 1;
    end if;
  end loop;

  update public.pacotes pa
     set etapa = 'separar', etapa_anterior = pa.etapa, etapa_desde = now(),
         atualizado_em = now()
   from public.envios e
  where e.id = pa.envio_id
    and pa.etapa = 'faturado'
    and e.etiqueta_conteudo is not null
    and not exists (
      select 1 from public.bloqueios b
      where b.pacote_id = pa.id and b.resolvido_em is null
    );

  return query select n_ok, n_erro;
end;
$$;

revoke all on function public.coletar_etiquetas_ml() from public, anon, authenticated;

-- As etiquetas que já entraram não têm o PDF. Pedir de novo traz os dois.
update public.envios set etiqueta_conteudo = null, etiqueta_pedida_em = null
 where etiqueta_conteudo is not null and etiqueta_pdf is null;
