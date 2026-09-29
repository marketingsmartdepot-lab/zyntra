-- Quem SÓ executa no galpão se identifica por PIN, nos dois lugares: no
-- coletor da separação e na bipagem da porta.
--
-- A divisão que ela desenhou, agora completa:
--   LOGIN  = quem USA o sistema (gera lista, confere, configura, enxerga)
--   PIN    = quem EXECUTA no chão (separa no corredor, bipa o carro na porta)
--
-- O aparelho fica logado com uma conta da equipe, como a máquina da bancada.
-- A PESSOA se identifica por PIN ao pegar a lista ou ao começar a carregar.
-- Assim quem só separa nunca precisa de e-mail, senha, nem cadastro de login.
--
-- Nome + PIN, e não PIN sozinho: com PIN sozinho eu teria de garantir que dois
-- operadores nunca escolhessem o mesmo número, e a trava de cinco erros
-- deixaria de proteger uma pessoa específica. Um toque no nome resolve os dois
-- problemas e custa um toque.

create or replace function public.identificar_operador(
  p_operador_id uuid,
  p_pin text
) returns table(ok boolean, motivo text, nome text)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_op public.operadores%rowtype;
begin
  perform public.exige_perfil_ativo();

  select * into v_op from public.operadores where id = p_operador_id;

  if not found or not v_op.ativo then
    return query select false, 'operador_invalido', null::text;
    return;
  end if;

  if v_op.bloqueado_ate is not null and v_op.bloqueado_ate > now() then
    return query select false, 'bloqueado', v_op.nome;
    return;
  end if;

  if v_op.pin_hash is null then
    return query select false, 'sem_pin', v_op.nome;
    return;
  end if;

  if extensions.crypt(p_pin, v_op.pin_hash) <> v_op.pin_hash then
    update public.operadores
       set tentativas_falhas = tentativas_falhas + 1,
           bloqueado_ate = case
             when tentativas_falhas + 1 >= 5 then now() + interval '10 minutes'
             else bloqueado_ate
           end
     where id = p_operador_id;

    return query select false, 'pin_incorreto', v_op.nome;
    return;
  end if;

  update public.operadores
     set tentativas_falhas = 0, bloqueado_ate = null
   where id = p_operador_id;

  return query select true, 'ok', v_op.nome;
end;
$fn$;

revoke all on function public.identificar_operador(uuid, text) from public;
grant execute on function public.identificar_operador(uuid, text) to authenticated;

/** Quem pode aparecer na lista de nomes do coletor e da porta. */
create or replace view public.operadores_para_identificar
with (security_invoker = true)
as
  select o.id, o.nome, o.papel::text as papel,
         (o.bloqueado_ate is not null and o.bloqueado_ate > now()) as bloqueado
  from public.operadores o
  where o.ativo and o.tem_pin;

grant select on public.operadores_para_identificar to authenticated;

-- `separador_id` volta a ser quem SEPAROU de fato, por PIN. Quem gerou a lista
-- continua em `criada_por`, que é login. Antes os dois guardavam a mesma
-- pessoa — o login de quem apertou o botão — e um deles era redundante.
update public.listas_separacao set separador_id = null where separador_id is not null;

alter table public.listas_separacao
  drop constraint listas_separacao_separador_id_fkey,
  add constraint listas_separacao_separador_id_fkey
    foreign key (separador_id) references public.operadores(id) on delete set null;

comment on column public.listas_separacao.separador_id is
  'Quem separou de fato, identificado por PIN no coletor. Quem GEROU a lista '
  'está em criada_por, por login.';
