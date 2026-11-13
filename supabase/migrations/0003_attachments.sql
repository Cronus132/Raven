-- Raven — Phase 2: encrypted attachment storage.
--
-- A private Storage bucket holds ONLY ciphertext blobs. Each attachment is
-- encrypted client-side with its own AES-256 key; that key travels only inside
-- the E2E-encrypted message, never to the server. Object paths are random
-- (uuids) and shared solely through the encrypted message, so allowing any
-- authenticated user to read the bucket is safe — the bytes are undecipherable
-- without the per-blob key.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Authenticated users may upload ciphertext blobs.
create policy "attachments upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');

-- Authenticated users may download ciphertext blobs (content is encrypted).
create policy "attachments read"
  on storage.objects for select to authenticated
  using (bucket_id = 'attachments');
