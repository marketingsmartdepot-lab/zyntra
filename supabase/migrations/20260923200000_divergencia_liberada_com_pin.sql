-- Liberar divergencia passa a exigir o PIN do lider.
--
-- A versao anterior liberava se o lider tivesse QUALQUER sessao de estacao
-- aberta — sem verificar que quem estava chamando era aquele lider. Bastava
-- saber o uuid de um lider que estivesse logado em alguma bancada para o
-- proprio operador liberar a propria divergencia. O controle existia no papel
-- e nao na pratica.
--
-- Agora o lider digita o PIN na bancada. E autorizacao fisica: ele precisa
-- estar ali. Mesma trava de cinco tentativas do turno, porque PIN de quatro
-- digitos sem trava se descobre por forca bruta em minutos.
--
-- Admin continua liberando sem PIN: ele entrou no sistema com e-mail e senha,
-- que e credencial mais forte, e precisa conseguir destravar remotamente.

drop function if exists public.liberar_divergencia(uuid, uuid, text);

create or replace function public.liberar_divergencia(
  p_divergencia_id uuid,
  p_lider_id uuid,
  p_motivo text,
  p_pin text default null
)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lider public.operadores%rowtype;
  v_admin boolean := public.e_admin();
begin
  if coalesce(trim(p_motivo), '') = '' then
    return query select false, 'motivo_obrigatorio';
    return;
  end if;

  select * into v_lider
  from public.operadores o
  where o.id = p_lider_id and o.papel = 'lider' and o.ativo;

  if not found then
    return query select false, 'nao_e_lider';
    return;
  end if;

  if not v_admin then
    if v_lider.bloqueado_ate is not null and v_lider.bloqueado_ate > now() then
      return query select false, 'bloqueado';
      return;
    end if;

    if v_lider.pin_hash is null then
      return query select false, 'lider_sem_pin';
      return;
    end if;

    if extensions.crypt(coalesce(p_pin, ''), v_lider.pin_hash) <> v_lider.pin_hash then
      -- Incrementa e RETORNA, nunca levanta excecao: excecao desfaz o
      -- proprio incremento e a trava nunca prende.
      update public.operadores o
         set tentativas_falhas = o.tentativas_falhas + 1,
             bloqueado_ate = case
               when o.tentativas_falhas + 1 >= 5 then now() + interval '10 minutes'
               else o.bloqueado_ate
             end
       where o.id = p_lider_id;

      return query select false, 'pin_incorreto';
      return;
    end if;

    update public.operadores o
       set tentativas_falhas = 0, bloqueado_ate = null
     where o.id = p_lider_id;
  end if;

  update public.divergencias d
     set liberada_em = now(),
         liberada_por = p_lider_id,
         motivo_liberacao = trim(p_motivo)
   where d.id = p_divergencia_id and d.liberada_em is null;

  if not found then
    return query select false, 'divergencia_nao_encontrada';
    return;
  end if;

  return query select true, 'ok';
end;
$$;

comment on function public.liberar_divergencia(uuid, uuid, text, text) is
  'So o lider libera, e provando com o PIN dele na bancada. Antes bastava o lider estar logado em qualquer lugar — quem chamava nao era verificado.';

revoke all on function public.liberar_divergencia(uuid, uuid, text, text) from public;
grant execute on function public.liberar_divergencia(uuid, uuid, text, text) to authenticated;

-- Quem esta esperando liberacao, com tudo que a tela precisa mostrar.
create or replace view public.divergencias_abertas
with (security_invoker = true)
as
select
  d.id,
  d.conferencia_id,
  d.tipo,
  d.detalhe,
  d.aberta_em,
  c.pacote_id,
  ct.apelido as conta,
  (select p.ref_externa from public.pedidos p
    where p.envio_id = pa.envio_id order by p.criado_em limit 1) as codigo
from public.divergencias d
join public.conferencias c on c.id = d.conferencia_id
join public.pacotes pa on pa.id = c.pacote_id
join public.contas ct on ct.id = pa.conta_id
where d.liberada_em is null;

comment on view public.divergencias_abertas is
  'Divergencias esperando um lider. Enquanto houver uma, a conferencia daquele pacote nao fecha.';
