-- Quem separa e quem confere é o LOGIN, não o PIN.
--
-- O desenho antigo supunha que a bancada se identificava por PIN, como a
-- doca. Ela corrigiu: a Cristina entra por e-mail e senha porque ela USA o
-- sistema — gera lista, confere, finaliza. O PIN fica com uma função só, e
-- limpa: identificar quem bipa os carros na porta, onde ninguém está com o
-- navegador logado.
--
-- As seis colunas abaixo estavam 100% nulas (13 linhas, 0 preenchidas), então
-- dá para repontar a chave estrangeira em vez de criar coluna paralela. Duas
-- colunas para a mesma ideia é o tipo de coisa que apodrece.

alter table public.listas_separacao
  drop constraint listas_separacao_separador_id_fkey,
  add constraint listas_separacao_separador_id_fkey
    foreign key (separador_id) references public.perfis(id) on delete set null;

alter table public.conferencias
  drop constraint conferencias_concluida_por_fkey,
  add constraint conferencias_concluida_por_fkey
    foreign key (concluida_por) references public.perfis(id) on delete set null;

alter table public.leituras
  drop constraint leituras_operador_id_fkey,
  add constraint leituras_operador_id_fkey
    foreign key (operador_id) references public.perfis(id) on delete set null;

-- Divergência é parte da conferência: deixá-la no PIN faria a bancada ter dois
-- donos ao mesmo tempo.
alter table public.divergencias
  drop constraint divergencias_aberta_por_fkey,
  add constraint divergencias_aberta_por_fkey
    foreign key (aberta_por) references public.perfis(id) on delete set null;

alter table public.divergencias
  drop constraint divergencias_liberada_por_fkey,
  add constraint divergencias_liberada_por_fkey
    foreign key (liberada_por) references public.perfis(id) on delete set null;

alter table public.impressoes
  drop constraint impressoes_operador_id_fkey,
  add constraint impressoes_operador_id_fkey
    foreign key (operador_id) references public.perfis(id) on delete set null;

comment on column public.leituras.operador_id is
  'Quem bipou, pelo login. O PIN identifica só quem bipa na doca e na porta.';
comment on column public.listas_separacao.separador_id is
  'Quem gerou a lista, pelo login.';
