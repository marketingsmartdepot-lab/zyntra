-- Eu tinha apontado `liberada_por` para perfis junto com o resto da bancada.
-- Errado: liberar divergência é um LÍDER autorizando na tela de OUTRA pessoa,
-- e ali o PIN é exatamente a ferramenta certa — ninguém desloga a conferente
-- para o líder entrar e sair.
--
-- `aberta_por` fica no login (quem abriu a divergência é quem está conferindo).
-- `liberada_por` volta para o operador de PIN.
alter table public.divergencias
  drop constraint divergencias_liberada_por_fkey,
  add constraint divergencias_liberada_por_fkey
    foreign key (liberada_por) references public.operadores(id) on delete set null;

comment on column public.divergencias.aberta_por is
  'Quem estava conferindo, pelo login.';
comment on column public.divergencias.liberada_por is
  'O líder que autorizou fechar com diferença, provando com o PIN na bancada.';
