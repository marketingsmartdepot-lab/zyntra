-- O agente passa a entrar com e-mail e senha, e as impressoras são DESCOBERTAS
-- na máquina em vez de digitadas.
--
-- Como era: um admin cadastrava a impressora digitando o nome dela e gerava um
-- token, que alguém colava num arquivo .env na máquina da bancada. Dois pontos
-- de falha calada: nome digitado errado (não imprime, e ninguém descobre por
-- quê) e token colado errado ou perdido.
--
-- Como fica: o agente entra com o login da própria pessoa, registra a máquina,
-- e manda a lista de impressoras que o sistema operacional dele enxerga. Na
-- tela, escolhe-se qual delas é a térmica de cada bancada.
--
-- A senha NÃO fica na máquina: é trocada uma vez por uma credencial do
-- dispositivo, que só serve para buscar e concluir impressão. Trocar o
-- computador não obriga ninguém a trocar de senha.
--
-- O desenho veio de olhar o cliente da Lexos, que a Daniele já usa: lá o
-- aplicativo faz login com o mesmo e-mail do sistema e publica as impressoras
-- da máquina, e a tela mostra máquina + impressora + método + cópias.

create table if not exists privado.dispositivos (
  id uuid primary key default gen_random_uuid(),
  nome_maquina text not null,
  sistema text,
  token_hash text not null,
  registrado_por uuid references public.perfis (id) on delete set null,
  criado_em timestamptz not null default now(),
  ultimo_contato_em timestamptz,
  versao_agente text
);

comment on table privado.dispositivos is
  'As maquinas que rodam o agente de impressao. A credencial e do dispositivo, nao da pessoa.';

alter table privado.dispositivos enable row level security;

create unique index if not exists dispositivos_maquina_idx
  on privado.dispositivos (lower(btrim(nome_maquina)));

alter table public.impressoras
  add column if not exists dispositivo_id uuid references privado.dispositivos (id) on delete cascade,
  add column if not exists nome_no_sistema text,
  add column if not exists tipo text not null default 'comum',
  add column if not exists copias integer not null default 1,
  add column if not exists vista_em timestamptz;

alter table public.impressoras drop constraint if exists impressoras_tipo_check;
alter table public.impressoras
  add constraint impressoras_tipo_check check (tipo in ('termica_zpl', 'comum'));

alter table public.impressoras drop constraint if exists impressoras_copias_check;
alter table public.impressoras
  add constraint impressoras_copias_check check (copias between 1 and 10);

-- A bancada deixa de ser obrigatória: a impressora aparece porque existe na
-- máquina, e só depois alguém diz a qual bancada ela serve.
alter table public.impressoras alter column estacao_id drop not null;

comment on column public.impressoras.nome_no_sistema is
  'O nome exato que o sistema operacional da maquina usa. Vem do agente, nunca digitado.';
comment on column public.impressoras.tipo is
  'termica_zpl imprime etiqueta; comum e o resto.';

create unique index if not exists impressoras_por_dispositivo_idx
  on public.impressoras (dispositivo_id, lower(btrim(nome_no_sistema)))
  where dispositivo_id is not null;

create or replace function public.registrar_dispositivo(
  p_nome_maquina text, p_sistema text default null, p_versao text default null
)
returns table (ok boolean, motivo text, token text)
language plpgsql security definer set search_path = ''
as $$
declare v_nome text := btrim(coalesce(p_nome_maquina, '')); v_id uuid; v_segredo text;
begin
  -- Quem registra é a pessoa logada no agente: é por isso que ele pede e-mail
  -- e senha uma vez. Perfil inativo não registra máquina nenhuma.
  perform public.exige_perfil_ativo();

  if v_nome = '' then
    return query select false, 'sem_nome_da_maquina', null::text; return;
  end if;

  v_segredo := encode(extensions.gen_random_bytes(24), 'hex');

  insert into privado.dispositivos (nome_maquina, sistema, token_hash, registrado_por, versao_agente)
  values (v_nome, p_sistema,
          extensions.crypt(v_segredo, extensions.gen_salt('bf')),
          auth.uid(), p_versao)
  on conflict (lower(btrim(nome_maquina))) do update
    set token_hash = excluded.token_hash, sistema = excluded.sistema,
        versao_agente = excluded.versao_agente, registrado_por = excluded.registrado_por
  returning id into v_id;

  -- O token carrega o endereço antes do ponto: a verificação vira uma leitura
  -- por chave e UM bcrypt, em vez de um bcrypt por linha.
  return query select true, 'ok', v_id::text || '.' || v_segredo;
end;
$$;

comment on function public.registrar_dispositivo is
  'Registra a maquina do agente e devolve a credencial dela UMA vez.';

revoke all on function public.registrar_dispositivo(text, text, text) from public, anon;
grant execute on function public.registrar_dispositivo(text, text, text) to authenticated;

create or replace function privado.dispositivo_da_credencial(p_token text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_id uuid; v_achado uuid;
begin
  if p_token !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9a-f]{48}$' then
    return null;
  end if;

  v_id := split_part(p_token, '.', 1)::uuid;

  select d.id into v_achado from privado.dispositivos d
  where d.id = v_id
    and d.token_hash = extensions.crypt(split_part(p_token, '.', 2), d.token_hash);

  return v_achado;
end;
$$;

revoke all on function privado.dispositivo_da_credencial(text) from public, anon, authenticated;

create or replace function public.publicar_impressoras(p_token text, p_impressoras jsonb)
returns table (ok boolean, motivo text, quantas integer)
language plpgsql security definer set search_path = ''
as $$
declare v_disp uuid; v_n integer := 0;
begin
  v_disp := privado.dispositivo_da_credencial(p_token);
  if v_disp is null then
    return query select false, 'credencial_invalida', 0; return;
  end if;

  update privado.dispositivos set ultimo_contato_em = now() where id = v_disp;

  insert into public.impressoras (dispositivo_id, nome, nome_no_sistema, vista_em)
  select v_disp, btrim(x->>'nome'), btrim(x->>'nome'), now()
  from jsonb_array_elements(coalesce(p_impressoras, '[]'::jsonb)) x
  where btrim(coalesce(x->>'nome','')) <> ''
  -- A condição do índice PARCIAL precisa aparecer aqui também, senão o
  -- Postgres não encontra o índice e recusa a instrução inteira.
  on conflict (dispositivo_id, lower(btrim(nome_no_sistema)))
    where dispositivo_id is not null
  do update set vista_em = now();

  get diagnostics v_n = row_count;
  return query select true, 'ok', v_n;
end;
$$;

comment on function public.publicar_impressoras is
  'O agente manda a lista de impressoras que o sistema operacional enxerga. Ninguem digita nome de impressora.';

revoke all on function public.publicar_impressoras(text, jsonb) from public;
grant execute on function public.publicar_impressoras(text, jsonb) to anon, authenticated;

drop function if exists public.agente_reservar_trabalhos(text, integer);

create function public.agente_reservar_trabalhos(p_token text, p_limite integer default 5)
returns table (id uuid, tipo text, conteudo text, copias integer, impressora text)
language plpgsql security definer set search_path = ''
as $$
-- As colunas de saída se chamam id, tipo e copias, e esses mesmos nomes
-- existem em `impressoes` E em `impressoras`, que agora aparecem juntas no
-- join. Sem isto o plpgsql recusa: "column reference id is ambiguous".
#variable_conflict use_column
declare v_disp uuid;
begin
  v_disp := privado.dispositivo_da_credencial(p_token);
  if v_disp is null then return; end if;

  update privado.dispositivos d set ultimo_contato_em = now() where d.id = v_disp;
  update public.impressoras i set ultimo_contato_em = now() where i.dispositivo_id = v_disp;

  -- O agente recebe o NOME da impressora em cada trabalho: é ele quem entrega
  -- ao spooler, e a máquina pode ter mais de uma impressora em uso.
  return query
  update public.impressoes im
     set situacao = 'entregue_ao_agente',
         entregue_ao_agente_em = now(),
         tentativas = im.tentativas + 1
   where im.id in (
     select x.id from public.impressoes x
     join public.impressoras p on p.id = x.impressora_id
     where p.dispositivo_id = v_disp
       and x.situacao = 'pendente'
       and x.conteudo is not null
     order by x.enviada_em
     limit greatest(p_limite, 1)
     for update skip locked
   )
  returning im.id, im.tipo::text, im.conteudo, im.copias,
            (select p.nome_no_sistema from public.impressoras p where p.id = im.impressora_id);
end;
$$;

drop function if exists public.agente_concluir_trabalho(text, uuid, boolean, text);

create function public.agente_concluir_trabalho(
  p_token text, p_impressao_id uuid, p_ok boolean, p_erro text default null
)
returns table (ok boolean, motivo text)
language plpgsql security definer set search_path = ''
as $$
declare v_disp uuid;
begin
  v_disp := privado.dispositivo_da_credencial(p_token);
  if v_disp is null then
    return query select false, 'credencial_invalida'; return;
  end if;

  update public.impressoes im
     set situacao = case when p_ok then 'impressa' else 'erro' end,
         erro = case when p_ok then null else p_erro end
   where im.id = p_impressao_id
     and im.impressora_id in (
       select p.id from public.impressoras p where p.dispositivo_id = v_disp
     );

  if not found then
    return query select false, 'trabalho_nao_encontrado'; return;
  end if;

  return query select true, 'ok';
end;
$$;

revoke all on function public.agente_reservar_trabalhos(text, integer) from public;
revoke all on function public.agente_concluir_trabalho(text, uuid, boolean, text) from public;
grant execute on function public.agente_reservar_trabalhos(text, integer) to anon, authenticated;
grant execute on function public.agente_concluir_trabalho(text, uuid, boolean, text) to anon, authenticated;

-- A tela precisa ver as máquinas, que moram no schema privado junto com o hash
-- da credencial. Definer para alcançar o privado, e por isso checa sozinha.
create or replace view public.maquinas_do_agente
with (security_invoker = false)
as
select
  d.id, d.nome_maquina, d.sistema, d.versao_agente, d.criado_em, d.ultimo_contato_em,
  (d.ultimo_contato_em is not null
     and d.ultimo_contato_em > now() - interval '90 seconds') as online,
  p.nome as registrada_por,
  (select count(*) from public.impressoras i where i.dispositivo_id = d.id)::integer as impressoras
from privado.dispositivos d
left join public.perfis p on p.id = d.registrado_por
where (select public.e_da_equipe());

comment on view public.maquinas_do_agente is
  'As maquinas que rodam o agente, sem jamais expor o hash da credencial.';

revoke all on public.maquinas_do_agente from anon;
grant select on public.maquinas_do_agente to authenticated;

create or replace function public.revogar_maquina(p_id uuid)
returns table (ok boolean, motivo text)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.e_admin() then
    return query select false, 'so_admin'; return;
  end if;

  delete from privado.dispositivos where id = p_id;

  if not found then
    return query select false, 'maquina_nao_encontrada'; return;
  end if;

  return query select true, 'ok';
end;
$$;

comment on function public.revogar_maquina is
  'Apaga a maquina e a credencial dela. E assim que se resolve computador roubado, trocado ou aposentado.';

revoke all on function public.revogar_maquina(uuid) from public, anon;
grant execute on function public.revogar_maquina(uuid) to authenticated;

-- O modelo antigo sai de cena: token por impressora, gerado pelo admin.
drop function if exists public.gerar_token_agente(uuid);
drop function if exists privado.agente_da_credencial(text);
drop table if exists privado.agentes_impressao;
