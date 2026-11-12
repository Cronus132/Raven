/**
 * Supabase client + auth-secret derivation.
 *
 * The server is the ciphertext-only directory: it stores public keys and routing
 * metadata, never private keys or plaintext. Auth is email + password.
 *
 * We never send the user's raw passphrase to the server. Instead the Supabase
 * account password is a *one-way* value derived from (email, passphrase) with a
 * slow KDF (scrypt). The server only ever stores a hash of that derived value,
 * so even a full directory compromise cannot recover the passphrase that wraps
 * the on-device key store — and that key store (and its own random salt) never
 * leave the device. Sign-in re-derives the same value, so one passphrase is
 * enough on every device.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { scrypt } from "@noble/hashes/scrypt";
import { toBase64, utf8 } from "@/lib/crypto/primitives";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the backend is configured; the app falls back to a local directory otherwise. */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Keys are published explicitly; no magic-link URL parsing needed.
        detectSessionInUrl: false,
        storageKey: "raven.auth",
      },
    })
  : null;

// Deterministic, reproducible across devices (salt is derived from the email),
// and deliberately slow so the stored hash resists offline guessing.
const AUTH_KDF = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 };

/** The Supabase account password: a slow one-way function of (email, passphrase). */
export function deriveAuthPassword(email: string, passphrase: string): string {
  const salt = utf8(`raven-supabase-auth:${email.trim().toLowerCase()}`);
  const dk = scrypt(utf8(passphrase.normalize("NFKC")), salt, AUTH_KDF);
  return toBase64(dk);
}

/** True for a value shaped like a Supabase auth uid (so we don't query the directory with demo ids). */
export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
