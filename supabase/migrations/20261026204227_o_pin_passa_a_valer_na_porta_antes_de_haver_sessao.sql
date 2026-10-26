-- O time da separacao vai entrar no celular com NOME + PIN, sem e-mail e sem
-- senha. Decisao da Daniele.
--
-- A conferencia de PIN ja existe e e boa: bcrypt via `crypt`, cinco erros
-- derrubam em bloqueio de dez minutos. O que ela nao serve e na PORTA —
-- `identificar_operador` comeca com `exige_perfil_ativo()`, e na porta ainda
-- nao ha sessao nenhuma. Era uma funcao para dizer "quem esta no aparelho"
-- DEPOIS de alguem ja ter entrado.
--
-- Entao o miolo desce para `privado`, sem guarda de sessao, e ganha duas
-- portas com guardas diferentes:
--
--   identificar_operador   exige sessao, como sempre (bancada, doca, porta)
--   conferir_pin_da_porta  nao exige, porque e ela que CRIA a sessao
--
-- A segunda so e alcancavel pela Edge Function `estacao`, que e quem tem a
-- chave de servico para abrir a sessao do aparelho.
--
-- O QUE ISTO NAO ENFRAQUECE: a trava de tentativas e a mesma, no mesmo lugar,
-- contando no mesmo registro.

create or replace function privado.conferir_pin(p_operador_id uuid, p_pin text)
returns table (ok boolean, motivo text, nome text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_op public.operadores%rowtype;
begin
  select * into v_op from public.operadores where id = p_operador_id;

  if not found or not v_op.ativo then
    return query select false, 'operador_invalido', null::text; return;
  end if;

  if v_op.bloqueado_ate is not null and v_op.bloqueado_ate > now() then
    return query select false, 'bloqueado', v_op.nome; return;
  end if;

  if v_op.pin_hash is null then
    return query select false, 'sem_pin', v_op.nome; return;
  end if;

  if extensions.crypt(p_pin, v_op.pin_hash) <> v_op.pin_hash then
    update public.operadores
       set tentativas_falhas = tentativas_falhas + 1,
           bloqueado_ate = case
             when tentativas_falhas + 1 >= 5 then now() + interval '10 minutes'
             else bloqueado_ate
           end
     where id = p_operador_id;

    return query select false, 'pin_incorreto', v_op.nome; return;
  end if;

  update public.operadores
     set tentativas_falhas = 0, bloqueado_ate = null
   where id = p_operador_id;

  return query select true, 'ok', v_op.nome;
end;
$function$;

comment on function privado.conferir_pin is
  'A conferencia do PIN, sem guarda de sessao. Nao e chamavel de fora: quem '
  'chama sao as duas portas em public, cada uma com o seu guarda.';

create or replace function public.identificar_operador(p_operador_id uuid, p_pin text)
returns table (ok boolean, motivo text, nome text)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform public.exige_perfil_ativo();
  return query select * from privado.conferir_pin(p_operador_id, p_pin);
end;
$function$;

create or replace function public.conferir_pin_da_porta(p_operador_id uuid, p_pin text)
returns table (ok boolean, motivo text, nome text)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return query select * from privado.conferir_pin(p_operador_id, p_pin);
end;
$function$;

comment on function public.conferir_pin_da_porta is
  'Confere o PIN SEM exigir sessao — e ela que abre a sessao do aparelho. '
  'Chamada so pela Edge Function `estacao`, nunca pelo navegador.';

revoke all on function public.conferir_pin_da_porta(uuid, text)
  from public, anon, authenticated;
grant execute on function public.conferir_pin_da_porta(uuid, text) to service_role;

-- So id e nome, e so de quem tem PIN e esta ativo. Nada de papel, e-mail ou
-- qualquer outra coluna: esta lista e visivel para quem abrir a tela de
-- entrada, e o que nao precisa estar la nao vai.
create or replace function public.operadores_da_porta()
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path to ''
as $function$
  select o.id, o.nome
  from public.operadores o
  where o.ativo and o.pin_hash is not null
  order by o.nome;
$function$;

comment on function public.operadores_da_porta is
  'Os nomes que aparecem na tela de entrada por PIN. So id e nome, so de quem '
  'tem PIN e esta ativo — a tela e publica, entao leva o minimo.';

revoke all on function public.operadores_da_porta() from public;
grant execute on function public.operadores_da_porta() to anon, authenticated;
