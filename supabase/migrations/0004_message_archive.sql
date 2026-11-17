-- Raven — Phase 2: durable, self-encrypted message archive (cross-device history).
--
-- Unlike `messages` (migration 0002), which is a transient relay queue drained
-- after delivery, this is DURABLE: one row per user holding the user's whole
-- chat history as a single AES-256-GCM blob, sealed on the client under a key
-- derived from the account passphrase (portable across the user's devices). A
-- newly added or reinstalled device downloads this row and decrypts it to
-- restore history it was never individually sent.
--
-- The server stores only ciphertext and cannot read it; RLS restricts every row
-- to its owner. No plaintext, and no key, ever reaches the server.

create table if not exists public.message_archive (
  owner_user  uuid primary key references public.profiles (id) on delete cascade,
  iv          text not null,             -- base64 AES-GCM nonce
  ciphertext  text not null,             -- base64 sealed history snapshot (JSON)
  updated_at  timestamptz not null default now()
);

alter table public.message_archive enable row level security;

-- Owner-only access: you can read, write, and delete only your own archive.
create policy "read own archive"
  on public.message_archive for select to authenticated
  using (owner_user = auth.uid());

create policy "insert own archive"
  on public.message_archive for insert to authenticated
  with check (owner_user = auth.uid());

create policy "update own archive"
  on public.message_archive for update to authenticated
  using (owner_user = auth.uid())
  with check (owner_user = auth.uid());

create policy "delete own archive"
  on public.message_archive for delete to authenticated
  using (owner_user = auth.uid());
