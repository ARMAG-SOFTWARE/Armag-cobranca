-- Fase 3: endereço estruturado e foto de documento do cliente.
--
-- Migration aditiva: nenhuma coluna existente é alterada ou removida — o
-- e-mail do cliente permanece intacto no banco (só deixou de aparecer na
-- tela desde a Fase 1); aqui só adicionamos endereço e documento.
--
-- A foto do documento fica num bucket de Storage PRIVADO (nunca público):
-- só é acessível via signed URL gerada no servidor para usuários
-- autenticados, nunca por link direto.

alter table clients
  add column if not exists street text,
  add column if not exists street_number text,
  add column if not exists neighborhood text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip_code text,
  add column if not exists document_photo_path text;

insert into storage.buckets (id, name, public)
values ('client-documents', 'client-documents', false)
on conflict (id) do nothing;

create policy "Authenticated full access to client-documents"
  on storage.objects
  for all to authenticated
  using (bucket_id = 'client-documents')
  with check (bucket_id = 'client-documents');
