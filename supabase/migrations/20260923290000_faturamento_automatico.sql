-- Faturamento automatico: pedir a nota ao Mercado Livre e responder por ela.
--
-- Duas regras governam tudo aqui:
--
-- 1. Emitir e IRREVERSIVEL. No ML nao ha endpoint de cancelamento, so o
--    painel. Nota errada emitida e nota errada no SEFAZ. Por isso a chave de
--    idempotencia, e por isso `contas.emissao_automatica` nasce desligada:
--    liga-se uma conta de cada vez, olhando.
--
-- 2. Repetir o mesmo erro nao conserta nada. Se a mesma rejeicao acontece
--    varias vezes na mesma conta, o problema e de cadastro e nao daquele
--    pedido — a emissao daquela conta pausa e alguem olha. Sem disjuntor, um
--    NCM faltando viraria trezentas rejeicoes iguais em minutos.
--
-- NOTA: a unidade de emissao foi corrigida depois, em
-- `uma_nota_por_pedido`: e o PEDIDO, nao o pacote.

create or replace function public.limite_do_disjuntor()
returns integer language sql immutable as $$ select 5 $$;

/**
 * A resposta do canal, aplicada na esteira.
 *
 * Autorizada tira o pacote de Aberto e manda para Faturado. Rejeitada faz o
 * contrario e registra a causa COM o campo a corrigir, que e o que permite a
 * aba Aberto agrupar trinta pedidos numa linha so.
 */
create or replace function public.registrar_resposta_nota(
  p_nota_id uuid,
  p_autorizada boolean,
  p_ref_externa text default null,
  p_serie text default null,
  p_numero bigint default null,
  p_chave_acesso text default null,
  p_xml_url text default null,
  p_danfe_url text default null,
  p_erro_codigo text default null,
  p_erro_mensagem text default null,
  p_campo_a_corrigir text default null
)
returns table (ok boolean, motivo text, disjuntor_acionado boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nota public.notas_fiscais%rowtype;
  v_iguais integer;
  v_pausou boolean := false;
begin
  select * into v_nota from public.notas_fiscais where id = p_nota_id;

  if not found then
    return query select false, 'nota_nao_encontrada', false;
    return;
  end if;

  if p_autorizada then
    update public.notas_fiscais
       set situacao = 'autorizada',
           ref_externa = coalesce(p_ref_externa, ref_externa),
           serie = p_serie,
           numero = p_numero,
           chave_acesso = p_chave_acesso,
           xml_url = p_xml_url,
           danfe_url = p_danfe_url,
           autorizada_em = now(),
           erro_codigo = null,
           erro_mensagem = null,
           campo_a_corrigir = null
     where id = p_nota_id;

    if v_nota.pacote_id is not null then
      update public.bloqueios
         set resolvido_em = now()
       where pacote_id = v_nota.pacote_id
         and tipo in ('sem_nota', 'rejeicao_fiscal', 'faturador_nao_configurado')
         and resolvido_em is null;

      perform public.reavaliar_pacote(v_nota.pacote_id);
    end if;

    return query select true, 'ok', false;
    return;
  end if;

  update public.notas_fiscais
     set situacao = 'rejeitada',
         erro_codigo = p_erro_codigo,
         erro_mensagem = p_erro_mensagem,
         campo_a_corrigir = p_campo_a_corrigir
   where id = p_nota_id;

  if v_nota.pacote_id is not null then
    insert into public.bloqueios (pacote_id, tipo, causa, codigo, detalhe)
    select v_nota.pacote_id, 'rejeicao_fiscal',
           coalesce(p_erro_mensagem, 'Rejeicao sem mensagem'),
           p_erro_codigo, p_campo_a_corrigir
    where not exists (
      select 1 from public.bloqueios b
      where b.pacote_id = v_nota.pacote_id
        and b.tipo = 'rejeicao_fiscal'
        and b.resolvido_em is null
    );

    update public.pacotes set etapa = 'aberto'
     where id = v_nota.pacote_id and etapa = 'faturado';
  end if;

  -- Disjuntor: mesma rejeicao, mesma conta, varias vezes.
  if p_erro_codigo is not null then
    select count(*) into v_iguais
    from public.notas_fiscais nf
    where nf.conta_id = v_nota.conta_id
      and nf.situacao = 'rejeitada'
      and nf.erro_codigo = p_erro_codigo
      and nf.atualizado_em > now() - interval '6 hours';

    if v_iguais >= public.limite_do_disjuntor() then
      update public.contas
         set emissao_pausada_em = now(),
             emissao_pausa_motivo =
               v_iguais || ' rejeicoes iguais (' || p_erro_codigo
               || '). A emissao parou para nao repetir o mesmo erro.'
       where id = v_nota.conta_id and emissao_pausada_em is null;

      v_pausou := found;
    end if;
  end if;

  return query select true, 'rejeitada', v_pausou;
end;
$$;

comment on function public.registrar_resposta_nota is
  'Aplica a resposta do canal na esteira e aciona o disjuntor quando a mesma rejeicao se repete na conta.';

create or replace function public.retomar_emissao(p_conta_id uuid)
returns table (ok boolean, motivo text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.papel_atual()::text, '') not in ('lider', 'admin') then
    return query select false, 'sem_permissao';
    return;
  end if;

  update public.contas
     set emissao_pausada_em = null, emissao_pausa_motivo = null
   where id = p_conta_id and emissao_pausada_em is not null;

  if not found then
    return query select false, 'nao_estava_pausada';
    return;
  end if;

  return query select true, 'ok';
end;
$$;

comment on function public.retomar_emissao is
  'Religa a emissao de uma conta depois que alguem olhou a causa. So lider ou admin.';

-- registrar_resposta_nota NAO e concedida a `authenticated`: ela aplica a
-- resposta do CANAL. Quem chama e a Edge Function, com a chave de servico.
-- Deixar a equipe marcar uma nota como autorizada seria deixar a esteira
-- andar sem nota nenhuma.
revoke all on function public.retomar_emissao(uuid) from public;
revoke all on function public.registrar_resposta_nota(
  uuid, boolean, text, text, bigint, text, text, text, text, text, text
) from public;
grant execute on function public.retomar_emissao(uuid) to authenticated;
