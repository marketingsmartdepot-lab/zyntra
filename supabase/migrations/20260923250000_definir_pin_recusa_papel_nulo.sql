-- `if not (papel_atual() in (...))` nao barra ninguem quando o papel e NULL.
--
-- `papel_atual()` devolve NULL para quem nao tem linha em `perfis`, ou tem e
-- esta inativa. Ai `NULL in ('lider','admin')` e NULL, `not NULL` e NULL, e
-- `if NULL then raise` NAO dispara: a guarda e pulada e a funcao segue.
--
-- Ou seja, quem estivesse autenticado sem perfil ativo podia definir o PIN de
-- QUALQUER operador — inclusive de um lider — e com esse PIN liberar as
-- proprias divergencias. A checagem existia e nao valia nada.
--
-- As politicas de RLS que usam o mesmo `papel_atual() in (...)` nao tem esse
-- problema: em RLS, NULL e tratado como falso e a linha e negada. A inversao
-- perigosa so acontece na checagem imperativa dentro de funcao.

create or replace function public.definir_pin_operador(
  p_operador_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- coalesce fecha o buraco do NULL: sem papel, sem permissao.
  if coalesce(public.papel_atual()::text, '') not in ('lider', 'admin') then
    raise exception 'So lider ou administrador define PIN.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'O PIN precisa ter de 4 a 8 digitos.'
      using errcode = 'check_violation';
  end if;

  update public.operadores
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
         tentativas_falhas = 0,
         bloqueado_ate = null
   where id = p_operador_id;

  if not found then
    raise exception 'Operador nao encontrado.' using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.definir_pin_operador is
  'So lider ou admin. O coalesce e essencial: sem ele, papel NULL pulava a guarda e qualquer autenticado definia o PIN de um lider.';
