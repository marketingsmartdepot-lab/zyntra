-- Copiar o papel do login para a bancada quebrava: a bancada só aceita
-- 'operador' e 'lider' (admin e analista não existem no chão de fábrica), e o
-- insert batia no operadores_papel_check.
--
-- E está certo assim — quem manda no sistema não vira chefe da esteira por
-- isso. Quem entra na bancada entra como operador, e promover a líder é uma
-- decisão à parte.
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
    values (coalesce(nullif(btrim(v_nome), ''), 'sem nome'),
            'operador'::public.papel, true, v_perfil)
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
