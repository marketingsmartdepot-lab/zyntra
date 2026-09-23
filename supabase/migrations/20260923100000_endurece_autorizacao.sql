-- Fecha uma falha de autorização em `liberar_divergencia`.
--
-- A função conferia se o ID passado era de um líder, mas não conferia se quem
-- estava CHAMANDO era aquele líder. Como ela é `security definer`, qualquer
-- usuário autenticado podia mandar o UUID de um líder e liberar a própria
-- divergência — a trava valia para o papel, não para a pessoa.
--
-- Numa conferência isso é sério: liberar divergência é justamente o ponto em
-- que alguém assume que a caixa pode sair com diferença.
--
-- A correção amarra a liberação a uma SESSÃO DE PIN ABERTA. O líder precisa
-- ter entrado de verdade numa estação. Administrador continua podendo liberar
-- pelo painel, porque aí a identidade já veio do login.

create or replace function public.liberar_divergencia(
  p_divergencia_id uuid,
  p_lider_id uuid,
  p_motivo text
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tem_sessao boolean;
begin
  if coalesce(trim(p_motivo), '') = '' then
    return query select false, 'motivo_obrigatorio';
    return;
  end if;

  if not exists (
    select 1 from public.operadores o
    where o.id = p_lider_id and o.papel = 'lider' and o.ativo
  ) then
    return query select false, 'nao_e_lider';
    return;
  end if;

  -- O líder tem que estar com sessão aberta em alguma bancada: é a prova de
  -- que ele digitou o PIN. Sem isso, saber o UUID bastaria.
  select exists (
    select 1 from public.sessoes_estacao se
    where se.operador_id = p_lider_id and se.encerrada_em is null
  ) into v_tem_sessao;

  if not v_tem_sessao and not public.e_admin() then
    return query select false, 'lider_sem_sessao_aberta';
    return;
  end if;

  update public.divergencias d
     set liberada_em = now(),
         liberada_por = p_lider_id,
         motivo_liberacao = p_motivo
   where d.id = p_divergencia_id and d.liberada_em is null;

  if not found then
    return query select false, 'divergencia_nao_encontrada';
    return;
  end if;

  return query select true, 'ok';
end;
$$;

comment on function public.liberar_divergencia is
  'So lider com sessao de PIN aberta libera, e so com motivo. Saber o UUID de um lider nao basta.';

-- As funções de bancada também passam a exigir perfil ativo. Elas são
-- `security definer` e chamáveis por qualquer autenticado; sem isso, uma conta
-- desativada continuaria operando a esteira.

create or replace function public.exige_perfil_ativo()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.papel_atual() is null then
    raise exception 'Perfil inativo ou inexistente.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.exige_perfil_ativo() from public, anon;
grant execute on function public.exige_perfil_ativo() to authenticated;

revoke all on function public.liberar_divergencia(uuid, uuid, text) from public, anon;
grant execute on function public.liberar_divergencia(uuid, uuid, text) to authenticated;
