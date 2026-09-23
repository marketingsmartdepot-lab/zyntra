-- Corrige a trava de PIN, que não travava.
--
-- O bug: `abrir_sessao_estacao` incrementava `tentativas_falhas` e depois
-- levantava exceção. No Postgres, a exceção desfaz TUDO o que a função fez —
-- inclusive o incremento. O contador voltava a zero a cada erro e nunca
-- chegava a cinco, então o bloqueio nunca acontecia.
--
-- Um PIN de quatro dígitos sem trava é questão de paciência para adivinhar.
--
-- A correção é a função não levantar exceção em falha de autenticação e sim
-- DEVOLVER o resultado. Sem exceção, o incremento persiste. Quem chama passa
-- a olhar `ok` em vez de capturar erro — que também é uma API melhor: falha de
-- senha é resposta esperada, não acidente.

drop function if exists public.abrir_sessao_estacao(uuid, uuid, text);

create or replace function public.abrir_sessao_estacao(
  p_estacao_id uuid,
  p_operador_id uuid,
  p_pin text
)
returns table (ok boolean, motivo text, sessao_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.operadores%rowtype;
  v_sessao uuid;
begin
  select * into v_op from public.operadores where id = p_operador_id;

  if not found or not v_op.ativo then
    return query select false, 'operador_invalido', null::uuid;
    return;
  end if;

  if v_op.bloqueado_ate is not null and v_op.bloqueado_ate > now() then
    return query select false, 'bloqueado', null::uuid;
    return;
  end if;

  if v_op.pin_hash is null
     or extensions.crypt(p_pin, v_op.pin_hash) <> v_op.pin_hash then
    update public.operadores
       set tentativas_falhas = tentativas_falhas + 1,
           bloqueado_ate = case
             when tentativas_falhas + 1 >= 5 then now() + interval '10 minutes'
             else bloqueado_ate
           end
     where id = p_operador_id;

    return query select false, 'pin_incorreto', null::uuid;
    return;
  end if;

  update public.operadores
     set tentativas_falhas = 0, bloqueado_ate = null
   where id = p_operador_id;

  update public.sessoes_estacao
     set encerrada_em = now()
   where estacao_id = p_estacao_id and encerrada_em is null;

  insert into public.sessoes_estacao (estacao_id, operador_id)
  values (p_estacao_id, p_operador_id)
  returning id into v_sessao;

  return query select true, 'ok', v_sessao;
end;
$$;

comment on function public.abrir_sessao_estacao is
  'Troca o operador da bancada. Devolve ok/motivo em vez de levantar exceção: exceção desfaria a contagem de tentativas e a trava nunca fecharia.';

revoke all on function public.abrir_sessao_estacao(uuid, uuid, text) from public, anon;
grant execute on function public.abrir_sessao_estacao(uuid, uuid, text) to authenticated;
