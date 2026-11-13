-- Raven — Phase 2: the ciphertext message queue + realtime delivery.
--
-- The server stores ONLY opaque ciphertext envelopes and routing metadata
-- (which device sent to which device). It never sees plaintext or keys. Each
-- row is one encrypted Double Ratchet message addressed to a single device.
-- Recipients read their queued rows on connect (offline queue) and receive new
-- ones via realtime; they delete rows once decrypted (drain).
--
-- NOTE: sender identity is currently stored as routing metadata (not sealed).
-- Sealed sender — hiding the sender from the server — is a later hardening step.

create table if not exists public.messages (
  id                bigint generated always as identity primary key,
  sender_user       uuid not null references public.profiles (id) on delete cascade,
  sender_device     text not null,
  recipient_user    uuid not null references public.profiles (id) on delete cascade,
  recipient_device  text not null,
  ciphertext        text not null,              -- base64 of the serialized envelope
  created_at        timestamptz not null default now()
);

-- Fast per-recipient queue reads, oldest first.
create index if not exists messages_recipient_idx
  on public.messages (recipient_user, recipient_device, id);

alter table public.messages enable row level security;

-- You may send only as yourself.
create policy "insert as sender"
  on public.messages for insert to authenticated
  with check (sender_user = auth.uid());

-- You may read only messages addressed to you.
create policy "read own inbox"
  on public.messages for select to authenticated
  using (recipient_user = auth.uid());

-- You may delete (drain) only messages addressed to you.
create policy "drain own inbox"
  on public.messages for delete to authenticated
  using (recipient_user = auth.uid());

-- Realtime: recipients subscribe to INSERTs on their own rows (RLS-filtered).
alter publication supabase_realtime add table public.messages;
