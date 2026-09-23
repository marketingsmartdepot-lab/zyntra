alter table public.canais
  add column if not exists icone_url text;

comment on column public.canais.icone_url is
  'Picto do marketplace. Caminho local (/canais/mercado-livre.svg) ou URL. A sigla so aparece se nao houver imagem.';

update public.canais set icone_url = '/canais/mercado-livre.svg' where slug = 'mercado_livre';
update public.canais set icone_url = '/canais/mercado-livre-full.svg' where slug = 'mercado_livre_full';
