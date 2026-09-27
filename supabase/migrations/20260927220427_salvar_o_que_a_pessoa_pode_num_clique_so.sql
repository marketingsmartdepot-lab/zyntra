-- Salvar o que uma pessoa pode, num clique só.
--
-- Recebe a lista inteira de caixinhas marcadas e ela mesma decide onde cada
-- uma mora: as do sistema em perfis.permissoes, as da bancada em colunas de
-- operadores. Quem marca não precisa saber que "bipar por SKU" vive noutra
-- tabela — essa é a diferença entre uma tela de permissões e duas.
--
-- E as escritas que estavam soltas na tabela viram funções com trava. Antes
-- eram UPDATE direto do navegador, valendo para qualquer líder pela RLS —
-- inclusive para ligar a bipagem, que é justamente o que esta tela controla.
create or replace function public.definir_permissoes(
  p_pessoa uuid,
  p_permissoes text[]
) returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_perfil uuid;
  v_operador uuid;
  v_do_perfil text[];
  v_bipa boolean;
  v_reinicia boolean;
  v_quer_bancada boolean;
  v_nome text;
begin
  if not (public.pode('mexer_equipe') or public.e_admin()) then
    return query select false, 'sem_permissao'; return;
  end if;

  -- O id pode ser o do login ou o da bancada: na tela e uma pessoa so.
  select p.id, p.nome into v_perfil, v_nome
  from public.perfis p where p.id = p_pessoa;

  if v_perfil is not null then
    select o.id into v_operador from public.operadores o where o.perfil_id = v_perfil;
  else
    select o.id, o.nome into v_operador, v_nome
    from public.operadores o where o.id = p_pessoa;
  end if;

  if v_perfil is null and v_operador is null then
    return query select false, 'pessoa_nao_encontrada'; return;
  end if;

  if v_perfil = auth.uid()
     and not public.e_admin()
     and not ('mexer_equipe' = any(coalesce(p_permissoes, '{}'))) then
    return query select false, 'nao_tire_a_sua_propria'; return;
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_do_perfil
  from unnest(coalesce(p_permissoes, '{}')) x
  where x in (select pp.chave from public.permissoes_possiveis() pp where pp.onde = 'perfil');

  v_bipa     := 'bipar_por_sku' = any(coalesce(p_permissoes, '{}'));
  v_reinicia := 'reiniciar_conferencia' = any(coalesce(p_permissoes, '{}'));
  v_quer_bancada := v_bipa or v_reinicia;

  if v_perfil is not null then
    update public.perfis p set permissoes = v_do_perfil where p.id = v_perfil;
  end if;

  if v_operador is null and v_quer_bancada and v_perfil is not null then
    insert into public.operadores (nome, papel, ativo, perfil_id)
    select coalesce(nullif(btrim(v_nome), ''), 'sem nome'), p.papel, true, v_perfil
    from public.perfis p where p.id = v_perfil
    returning operadores.id into v_operador;
  end if;

  if v_operador is not null then
    update public.operadores o
       set pode_bipar_por_sku = v_bipa,
           pode_reiniciar_conferencia = v_reinicia,
           atualizado_em = now()
     where o.id = v_operador;
  end if;

  return query select true, 'ok';
end;
$fn$;

revoke all on function public.definir_permissoes(uuid, text[]) from public;
grant execute on function public.definir_permissoes(uuid, text[]) to authenticated;

/** Cadastra alguem que trabalha na bancada e nao tem login. */
create or replace function public.criar_pessoa_na_bancada(
  p_nome text,
  p_papel text default 'operador'
) returns table(ok boolean, motivo text, pessoa_id uuid)
language plpgsql
security definer
set search_path to ''
as $fn$
declare v_id uuid; v_nome text := btrim(coalesce(p_nome, ''));
begin
  if not (public.pode('mexer_equipe') or public.e_admin()) then
    return query select false, 'sem_permissao', null::uuid; return;
  end if;

  if v_nome = '' then
    return query select false, 'nome_vazio', null::uuid; return;
  end if;

  insert into public.operadores (nome, papel, ativo)
  values (v_nome, p_papel::public.papel, true)
  returning operadores.id into v_id;

  return query select true, 'ok', v_id;
end;
$fn$;

/** Liga e desliga o acesso de bancada de alguem. */
create or replace function public.bancada_ativa(
  p_operador_id uuid,
  p_ativo boolean
) returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  if not (public.pode('mexer_equipe') or public.e_admin()) then
    return query select false, 'sem_permissao'; return;
  end if;

  update public.operadores o
     set ativo = coalesce(p_ativo, false), atualizado_em = now()
   where o.id = p_operador_id;

  if not found then
    return query select false, 'pessoa_nao_encontrada'; return;
  end if;

  return query select true, 'ok';
end;
$fn$;

/**
 * Destrava quem errou o PIN. Sem isto a unica saida seria esperar dez minutos
 * parado, e num galpao dez minutos de bancada parada e fila.
 */
create or replace function public.destravar_bancada(p_operador_id uuid)
returns table(ok boolean, motivo text)
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  if not (public.pode('mexer_equipe') or public.e_admin()) then
    return query select false, 'sem_permissao'; return;
  end if;

  update public.operadores o
     set tentativas_falhas = 0, bloqueado_ate = null, atualizado_em = now()
   where o.id = p_operador_id;

  if not found then
    return query select false, 'pessoa_nao_encontrada'; return;
  end if;

  return query select true, 'ok';
end;
$fn$;

revoke all on function public.criar_pessoa_na_bancada(text, text) from public;
revoke all on function public.bancada_ativa(uuid, boolean) from public;
revoke all on function public.destravar_bancada(uuid) from public;
grant execute on function public.criar_pessoa_na_bancada(text, text) to authenticated;
grant execute on function public.bancada_ativa(uuid, boolean) to authenticated;
grant execute on function public.destravar_bancada(uuid) to authenticated;

-- O PIN e da pessoa, nao da integracao: com a lista unica, quem mexe em gente
-- e quem define PIN.
do $mig$
declare v_def text; v_n integer;
  v_de text := $de$not public.pode('mexer_integracao')$de$;
  v_para text := $para$not public.pode('mexer_equipe')$para$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'definir_pin_operador';

  if position(v_para in v_def) > 0 then
    raise notice 'definir_pin_operador ja estava com a trava nova.';
  else
    v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
    if v_n <> 1 then
      raise exception 'definir_pin_operador: trecho apareceu % vez(es).', v_n;
    end if;
    execute replace(v_def, v_de, v_para);
  end if;
end
$mig$;
