-- Renomeia `unidades` para `pacotes`.
--
-- "Unidade" no galpão significa unidade de PRODUTO. A tabela guardava uma
-- linha por envio — uma etiqueta, uma caixa — e o nome fazia qualquer frase
-- sobre a regra virar armadilha:
--
--   "uma unidade não pode estar em duas listas"
--
-- Lido como produto, isso é falso e perigoso: o mesmo SKU está em várias
-- listas ao mesmo tempo, sempre. Lido como pacote, é verdade.
--
-- `pacotes.unidades_esperadas` continua com esse nome e agora lê certo:
-- quantas unidades de produto devem estar dentro daquele pacote.

alter table public.unidades rename to pacotes;
alter table public.eventos_unidade rename to eventos_pacote;

alter table public.eventos_pacote rename column unidade_id to pacote_id;
alter table public.bloqueios rename column unidade_id to pacote_id;

alter index if exists unidades_etapa_idx rename to pacotes_etapa_idx;
alter index if exists unidades_conta_idx rename to pacotes_conta_idx;
alter index if exists eventos_unidade_idx rename to eventos_pacote_idx;

comment on table public.pacotes is
  'A unidade da esteira: um pacote por envio — uma etiqueta, uma caixa. Cada um está em exatamente uma etapa.';
comment on column public.pacotes.unidades_esperadas is
  'Quantas unidades de produto devem estar dentro da caixa, já expandidas por kit.';
comment on table public.eventos_pacote is
  'Linha do tempo do pacote: a aba Histórico sai daqui.';

-- O gatilho de transição escrevia em `eventos_unidade`. Recriado com o nome
-- novo — sem isso, a primeira mudança de etapa quebraria.
create or replace function public.validar_transicao_etapa()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  permitido boolean := false;
begin
  if new.etapa = old.etapa then
    return new;
  end if;

  if new.etapa in ('encerrado', 'retido') then
    permitido := true;
  elsif old.etapa = 'retido' then
    permitido := new.etapa = old.etapa_anterior;
  else
    permitido := (old.etapa, new.etapa) in (
      ('aberto',   'faturado'),
      ('faturado', 'separar'),
      ('faturado', 'aberto'),
      ('separar',  'conferir'),
      ('separar',  'faturado'),
      ('conferir', 'pronto'),
      ('conferir', 'separar')
    );
  end if;

  if not permitido then
    raise exception
      'Transicao de etapa invalida: % -> % (pacote %)',
      old.etapa, new.etapa, old.id
      using errcode = 'check_violation';
  end if;

  if new.etapa = 'retido' and old.etapa <> 'retido' then
    new.etapa_anterior := old.etapa;
  elsif old.etapa = 'retido' then
    new.etapa_anterior := null;
  end if;

  new.etapa_desde := now();

  insert into public.eventos_pacote (pacote_id, tipo, de, para, por)
  values (old.id, 'etapa', old.etapa::text, new.etapa::text, auth.uid());

  return new;
end;
$$;

-- A view de anúncios sem SKU não toca nessas tabelas, então segue como está.
