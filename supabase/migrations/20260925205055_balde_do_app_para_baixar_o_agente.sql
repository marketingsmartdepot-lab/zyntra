-- Onde mora o instalador do agente, para haver um botão "Baixar o app".
--
-- Leitura é pública de propósito: a máquina da bancada ainda não tem login
-- nenhum quando vai baixar o programa. O que está aqui é um instalador, não
-- dado de ninguém — a credencial só nasce depois, quando a pessoa entra.
--
-- Escrita é só de administrador. Sem isso, qualquer um com a chave pública do
-- projeto trocaria o executável que o galpão inteiro baixa.

insert into storage.buckets (id, name, public)
values ('app', 'app', true)
on conflict (id) do update set public = true;

drop policy if exists "app: qualquer um baixa" on storage.objects;
create policy "app: qualquer um baixa"
  on storage.objects for select
  using (bucket_id = 'app');

drop policy if exists "app: só admin publica" on storage.objects;
create policy "app: só admin publica"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'app' and (select public.e_admin()));

drop policy if exists "app: só admin troca" on storage.objects;
create policy "app: só admin troca"
  on storage.objects for update to authenticated
  using (bucket_id = 'app' and (select public.e_admin()))
  with check (bucket_id = 'app' and (select public.e_admin()));

drop policy if exists "app: só admin apaga" on storage.objects;
create policy "app: só admin apaga"
  on storage.objects for delete to authenticated
  using (bucket_id = 'app' and (select public.e_admin()));
