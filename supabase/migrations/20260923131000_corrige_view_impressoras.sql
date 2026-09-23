-- `impressoras_situacao` lia `privado.agentes_impressao` para saber se a
-- impressora já tem token. Como a view é security_invoker e ninguém — nem
-- `authenticated` — tem acesso ao schema `privado`, a view inteira devolvia
-- permission denied. Foi exatamente a tranca dos segredos funcionando contra
-- a tela.
--
-- A correção não é afrouxar a tranca: é o schema público guardar o FATO de
-- que existe token, sem guardar o token. Saber que existe não é segredo;
-- o valor é.

alter table public.impressoras
  add column if not exists token_gerado_em timestamptz;

comment on column public.impressoras.token_gerado_em is
  'Quando o token do agente foi gerado. O token em si vive em privado.agentes_impressao.';

create or replace function public.gerar_token_agente(p_impressora_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.e_admin() then
    raise exception 'So administrador gera token de agente.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.impressoras i where i.id = p_impressora_id) then
    raise exception 'Impressora nao encontrada.' using errcode = 'no_data_found';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into privado.agentes_impressao (impressora_id, token_hash, gerado_por)
  values (p_impressora_id, extensions.crypt(v_token, extensions.gen_salt('bf')), auth.uid())
  on conflict (impressora_id) do update
    set token_hash = excluded.token_hash,
        gerado_em = now(),
        gerado_por = excluded.gerado_por;

  update public.impressoras set token_gerado_em = now() where id = p_impressora_id;

  return v_token;
end;
$$;

drop view if exists public.impressoras_situacao;

create view public.impressoras_situacao
with (security_invoker = true)
as
select
  i.id, i.nome, i.modelo, i.conexao, i.linguagem, i.dpi, i.largura_mm,
  i.ativa, i.agente_versao, i.ultimo_contato_em,
  e.id as estacao_id, e.nome as estacao,
  (i.ultimo_contato_em is not null
   and i.ultimo_contato_em > now() - interval '2 minutes') as agente_online,
  (i.token_gerado_em is not null) as token_gerado,
  (select count(*)::integer from public.impressoes im
    where im.impressora_id = i.id and im.situacao = 'pendente') as na_fila,
  (select max(im.enviada_em) from public.impressoes im
    where im.impressora_id = i.id) as ultimo_trabalho_em
from public.impressoras i
left join public.estacoes e on e.id = i.estacao_id;

comment on view public.impressoras_situacao is
  'O que a aba de impressoras mostra. Nao toca no schema privado: guarda o fato do token, nao o token.';
