-- A primeira bipagem: a caixa sai da expedicao e vai para a doca.
--
-- Sem isto a estacao de saida era inalcancavel: `bipar_saida` exige que o
-- pacote tenha passado pela doca, e nada escrevia em `entregas_doca`. O
-- fechamento do Flex nunca acumularia um centavo.
--
-- A entrega pode ser mista: o operador leva o carrinho inteiro de uma vez e a
-- doca se organiza sozinha, porque as views agrupam pela modalidade do proprio
-- pacote e nao pela da entrega.

create or replace function public.abrir_entrega_doca(
  p_entregue_por text,
  p_operador_id uuid default null
)
returns table (ok boolean, motivo text, entrega_id uuid, codigo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_codigo text;
begin
  -- O nome de quem levou e o ponto da entrega: e por ele que se descobre
  -- quem estava com a caixa quando ela sumiu.
  if coalesce(trim(p_entregue_por), '') = '' then
    return query select false, 'sem_nome', null::uuid, null::text;
    return;
  end if;

  v_codigo := 'DOC-'
    || to_char(now() at time zone 'America/Sao_Paulo', 'DDMM')
    || '-' || lpad((
         select (count(*) + 1)::text from public.entregas_doca ed
         where ed.entregue_em::date = (now() at time zone 'America/Sao_Paulo')::date
       ), 3, '0');

  insert into public.entregas_doca (codigo, entregue_por, operador_id, registrada_por)
  values (v_codigo, trim(p_entregue_por), p_operador_id, auth.uid())
  returning id into v_id;

  return query select true, 'ok', v_id, v_codigo;
end;
$$;

comment on function public.abrir_entrega_doca is
  'Abre a relacao de entrega para a doca. O nome de quem leva e obrigatorio.';

revoke all on function public.abrir_entrega_doca(text, uuid) from public;
grant execute on function public.abrir_entrega_doca(text, uuid) to authenticated;

-- As entregas do dia, para a tela listar e retomar.
create or replace view public.entregas_doca_resumo
with (security_invoker = true)
as
select
  ed.id,
  ed.codigo,
  ed.entregue_por,
  ed.entregue_em,
  o.nome as operador,
  count(ep.pacote_id)::integer as pacotes,
  count(sp.pacote_id)::integer as ja_sairam
from public.entregas_doca ed
left join public.operadores o on o.id = ed.operador_id
left join public.entregas_doca_pacotes ep on ep.entrega_id = ed.id
left join public.saida_pacotes sp on sp.pacote_id = ep.pacote_id
group by ed.id, ed.codigo, ed.entregue_por, ed.entregue_em, o.nome;

comment on view public.entregas_doca_resumo is
  'As entregas para a doca, com quantos pacotes cada uma trouxe e quantos ja sairam do galpao.';
