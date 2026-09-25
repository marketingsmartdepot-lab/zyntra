-- A impressora tinha duas colunas para a mesma pergunta: `tipo`
-- ('termica_zpl'/'comum') e `linguagem` ('zpl'/'pdf'). As duas eram gravadas
-- pela tela e lidas por ninguém — o agente sempre mandava ZPL cru, fosse qual
-- fosse a escolha.
--
-- Fica `linguagem`, que já dizia ZPL ou PDF, e ela passa a viajar com o
-- trabalho até o agente. "Não usar esta impressora" continua sendo `ativa`,
-- que `impressora_da_estacao` já respeita.

-- 1. quem era térmica vira zpl; quem era comum, pdf (é papel A4)
update public.impressoras set linguagem = 'zpl'  where tipo = 'termica_zpl';
update public.impressoras set linguagem = 'pdf'  where tipo = 'comum';

alter table public.impressoras drop column tipo;

-- 2. o trabalho leva a linguagem: sem isso o agente não sabe o que fazer
--    com o conteúdo que recebeu.
drop function if exists public.agente_reservar_trabalhos(text, integer);

create function public.agente_reservar_trabalhos(p_token text, p_limite integer default 5)
returns table(id uuid, tipo text, conteudo text, copias integer,
              impressora text, linguagem text)
language plpgsql
security definer
set search_path to ''
as $$
#variable_conflict use_column
declare v_disp uuid;
begin
  v_disp := privado.dispositivo_da_credencial(p_token);
  if v_disp is null then return; end if;

  update privado.dispositivos d set ultimo_contato_em = now() where d.id = v_disp;
  update public.impressoras i set ultimo_contato_em = now() where i.dispositivo_id = v_disp;

  -- O agente recebe o NOME da impressora em cada trabalho: é ele quem entrega
  -- ao spooler, e a máquina pode ter mais de uma impressora em uso. E recebe a
  -- LINGUAGEM, porque ZPL vai cru para a impressora e PDF precisa de um
  -- caminho completamente diferente.
  return query
  update public.impressoes im
     set situacao = 'entregue_ao_agente',
         entregue_ao_agente_em = now(),
         tentativas = im.tentativas + 1
   where im.id in (
     select x.id from public.impressoes x
     join public.impressoras p on p.id = x.impressora_id
     where p.dispositivo_id = v_disp
       and x.situacao = 'pendente'
       and x.conteudo is not null
     order by x.enviada_em
     limit greatest(p_limite, 1)
     for update skip locked
   )
  returning im.id, im.tipo::text, im.conteudo, im.copias,
            (select p.nome_no_sistema from public.impressoras p where p.id = im.impressora_id),
            (select p.linguagem       from public.impressoras p where p.id = im.impressora_id);
end;
$$;

revoke all on function public.agente_reservar_trabalhos(text, integer) from public;
grant execute on function public.agente_reservar_trabalhos(text, integer) to anon, authenticated;
