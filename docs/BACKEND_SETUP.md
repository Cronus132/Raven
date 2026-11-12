# Backend setup — Supabase (Phase 1)

Raven's backend only ever handles **ciphertext, public keys, and routing metadata**, so a
managed free tier is safe to use — it never sees message content. This sets up the Phase 1
directory (accounts, devices, prekeys). Realtime delivery + the ciphertext queue come in Phase 2.

You only need to do steps 1–4 now; hand me the two values from step 3 and I'll wire the client.

## 1. Create the project

1. Go to **https://supabase.com** → sign in → **New project**.
2. Name it `raven` (or anything). Choose a region near you. Set a strong database password (save it).
3. Wait for it to finish provisioning (~2 min).

> Free tier note: projects pause after ~1 week idle and have throughput/storage caps — fine for
> personal use. We can move the relay/queue to Cloudflare later if needed.

## 2. Create the schema

1. In the project, open **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase/migrations/0001_identity_and_directory.sql`](../supabase/migrations/0001_identity_and_directory.sql).
3. Click **Run**. You should see "Success. No rows returned."

This creates `profiles`, `devices`, `signed_prekeys`, `one_time_prekeys`, row-level security
policies (public keys are readable by any signed-in user; writes are owner-only), the
`claim_prekey_bundle()` function (atomically consumes a one-time prekey), and a trigger that
creates a profile row on sign-up.

## 3. Get the client keys

1. Open **Project Settings → API**.
2. Copy **Project URL** and the **anon / public** key.
3. Give me those two values — or put them in `apps/web/.env` yourself:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
```

(Template in [`apps/web/.env.example`](../apps/web/.env.example). The anon key is meant to be
public; RLS is what protects the data. **Never** add the `service_role` key — it bypasses RLS.)

## 4. Configure auth

1. Open **Authentication → Providers → Email**. Keep it enabled.
2. For quick local testing, **Authentication → Sign In / Providers → Email**: turn **Confirm email**
   OFF (so sign-up logs in immediately). Turn it back on before any real use.
3. Passkeys (WebAuthn) are added in the client on top of this in a later Phase 1 step.

## What I'll do once you share the keys

- Add `@supabase/supabase-js`, wire a `SupabaseKeyDirectory` that implements the same
  `KeyDirectory` interface the app already uses (so nothing above it changes).
- Swap registration/unlock to: sign up/in with email → publish the device's public bundle to the
  directory → fetch contacts' bundles via `claim_prekey_bundle`.
- Keep all private keys on-device (the encrypted IndexedDB store is already built).

Until then the app runs fully against a local in-memory directory, so you can create an identity
and explore without the backend.
