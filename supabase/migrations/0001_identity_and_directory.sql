-- Raven — Phase 1: accounts, devices, and the key directory.
--
-- The server stores ONLY public keys and routing metadata. No private keys,
-- no plaintext. Email lives in Supabase's auth.users; profiles hold the public
-- handle. Devices publish an identity key + prekeys; other users fetch bundles
-- to start sessions. One-time prekeys are consumed atomically on fetch.

-- ---------------------------------------------------------------------------
-- profiles: one row per account, 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- devices: each device is a separate cryptographic identity under one account
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id               text primary key,                 -- client-generated device id
  user_id          uuid not null references public.profiles (id) on delete cascade,
  registration_id  integer not null,
  identity_key     text not null,                    -- base64 Ed25519 public identity key
  display_name     text,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
create index if not exists devices_user_id_idx on public.devices (user_id);

-- ---------------------------------------------------------------------------
-- signed_prekeys: rotated periodically, signed by the identity key
-- ---------------------------------------------------------------------------
create table if not exists public.signed_prekeys (
  device_id    text not null references public.devices (id) on delete cascade,
  key_id       integer not null,
  public_key   text not null,                        -- base64 X25519 public
  signature    text not null,                        -- base64 Ed25519 signature
  created_at   timestamptz not null default now(),
  primary key (device_id, key_id)
);

-- ---------------------------------------------------------------------------
-- one_time_prekeys: consumed (deleted) on fetch so each is used once
-- ---------------------------------------------------------------------------
create table if not exists public.one_time_prekeys (
  device_id    text not null references public.devices (id) on delete cascade,
  key_id       integer not null,
  public_key   text not null,                        -- base64 X25519 public
  created_at   timestamptz not null default now(),
  primary key (device_id, key_id)
);
create index if not exists otk_device_idx on public.one_time_prekeys (device_id);

-- ---------------------------------------------------------------------------
-- Row-level security
--   Public keys are directory data: any authenticated user may READ them to
--   start a session. Writes are restricted to the owning account.
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.devices           enable row level security;
alter table public.signed_prekeys    enable row level security;
alter table public.one_time_prekeys  enable row level security;

-- profiles
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);
create policy "insert own profile"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "update own profile"
  on public.profiles for update to authenticated using (id = auth.uid());

-- devices
create policy "devices readable by authenticated"
  on public.devices for select to authenticated using (true);
create policy "manage own devices"
  on public.devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- signed_prekeys
create policy "signed prekeys readable by authenticated"
  on public.signed_prekeys for select to authenticated using (true);
create policy "manage own signed prekeys"
  on public.signed_prekeys for all to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id and d.user_id = auth.uid()))
  with check (exists (select 1 from public.devices d where d.id = device_id and d.user_id = auth.uid()));

-- one_time_prekeys (direct reads disabled: must go through claim RPC so each OTK
-- is consumed exactly once; owners may insert/delete their own)
create policy "manage own one time prekeys"
  on public.one_time_prekeys for all to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id and d.user_id = auth.uid()))
  with check (exists (select 1 from public.devices d where d.id = device_id and d.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- claim_prekey_bundle: atomically fetch a device's bundle, consuming one OTK.
-- SECURITY DEFINER so it can pop an OTK the caller cannot read directly.
-- ---------------------------------------------------------------------------
create or replace function public.claim_prekey_bundle(p_device_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device        public.devices%rowtype;
  v_spk           public.signed_prekeys%rowtype;
  v_otk           public.one_time_prekeys%rowtype;
begin
  select * into v_device from public.devices where id = p_device_id;
  if not found then
    return null;
  end if;

  select * into v_spk from public.signed_prekeys
    where device_id = p_device_id order by key_id desc limit 1;

  -- pop one one-time prekey atomically
  delete from public.one_time_prekeys
  where ctid = (
    select ctid from public.one_time_prekeys
    where device_id = p_device_id
    order by key_id asc
    limit 1
    for update skip locked
  )
  returning * into v_otk;

  return json_build_object(
    'deviceId', v_device.id,
    'userId', v_device.user_id,
    'registrationId', v_device.registration_id,
    'identityKey', v_device.identity_key,
    'signedPreKeyId', v_spk.key_id,
    'signedPreKey', v_spk.public_key,
    'signedPreKeySignature', v_spk.signature,
    'oneTimePreKeyId', v_otk.key_id,
    'oneTimePreKey', v_otk.public_key
  );
end;
$$;

grant execute on function public.claim_prekey_bundle(text) to authenticated;

-- Auto-create a profile row when a user signs up (username comes from metadata).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
