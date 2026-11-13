import { create } from "zustand";
import { computeSafetyNumber, createDeviceSecret, publicBundle, shortFingerprint, type DeviceSecret } from "@/lib/crypto/identity";
import { LocalKeyDirectory, type KeyDirectory } from "@/lib/crypto/directory";
import { SupabaseKeyDirectory } from "@/lib/crypto/supabaseDirectory";
import {
  type AccountMeta,
  hasStoredIdentity,
  loadMeta,
  saveIdentity,
  UnlockError,
  unlockIdentity,
  wipeIdentity,
} from "@/lib/crypto/keystore";
import { toBase64 } from "@/lib/crypto/primitives";
import {
  enrollPasskey as enrollPasskeyWebAuthn,
  hasPasskey as hasPasskeyStored,
  passkeysAvailable,
  recoverPassphraseWithPasskey,
  removePasskey as removePasskeyStored,
} from "@/lib/crypto/passkey";
import { supabase, isSupabaseConfigured, deriveAuthPassword } from "@/lib/backend/supabase";
import { startMessaging, stopMessaging } from "@/lib/chat/liveMessaging";
import { USERS } from "@/data/seed";
import { useChatStore } from "./useChatStore";

type Status = "loading" | "none" | "locked" | "unlocked";

// The key directory the client talks to: Supabase when configured, otherwise a
// local in-memory directory so the app still runs fully offline.
const demoIds = Object.keys(USERS).filter((id) => id !== "me");
const directory: KeyDirectory = isSupabaseConfigured
  ? new SupabaseKeyDirectory(demoIds)
  : new LocalKeyDirectory(demoIds);

/** Publish this device's public keys, preferring the full-set path when available. */
async function publishDevice(secret: DeviceSecret, userId: string): Promise<void> {
  if (directory.publishKeys) await directory.publishKeys(secret, userId);
  else await directory.publish(publicBundle(secret, userId));
}

/** Turn a raw auth error into something a person can act on. */
function mapAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered"))
    return "That email already has an account — unlock it, or use another email.";
  if (m.includes("database error"))
    return "Couldn't create the account (that username may be taken). Try a different username.";
  if (m.includes("password"))
    return "The server rejected that passphrase. Use a longer one.";
  return msg;
}

interface IdentityState {
  status: Status;
  meta: AccountMeta | null;
  secret: DeviceSecret | null;
  passphrase: string | null; // in-memory only, held while unlocked to re-seal prekeys
  error: string | null;
  busy: boolean;
  passkeySupported: boolean; // this device can do platform passkeys
  hasPasskey: boolean; // a passkey is enrolled on this device

  init: () => Promise<void>;
  register: (input: { username: string; email: string; passphrase: string }) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  unlockWithPasskey: () => Promise<void>;
  enrollPasskey: () => Promise<void>;
  removePasskey: () => Promise<void>;
  lock: () => void;
  wipe: () => Promise<void>;
  clearError: () => void;

  fingerprint: () => string | null;
  safetyNumberWith: (remoteUserId: string) => Promise<string | null>;
}

function syncMe(meta: AccountMeta) {
  useChatStore.setState((s) => ({
    me: { ...s.me, name: meta.username, handle: `@${meta.username}` },
    users: { ...s.users, me: { ...s.users.me, name: meta.username, handle: `@${meta.username}` } },
  }));
}

export const useIdentityStore = create<IdentityState>((set, get) => ({
  status: "loading",
  meta: null,
  secret: null,
  passphrase: null,
  error: null,
  busy: false,
  passkeySupported: false,
  hasPasskey: false,

  init: async () => {
    const [supported, hasPk] = await Promise.all([passkeysAvailable(), hasPasskeyStored()]);
    set({ passkeySupported: supported, hasPasskey: hasPk });
    if (await hasStoredIdentity()) {
      const meta = (await loadMeta()) ?? null;
      set({ status: "locked", meta });
    } else {
      set({ status: "none" });
    }
  },

  register: async ({ username, email, passphrase }) => {
    set({ busy: true, error: null });
    try {
      let userId: string;

      if (isSupabaseConfigured && supabase) {
        // Account credentials: email + a slow one-way derivation of the passphrase.
        const password = deriveAuthPassword(email, passphrase);
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username } },
        });
        if (error) throw new Error(mapAuthError(error.message));
        const uid = data.user?.id;
        if (!uid) throw new Error("Sign-up did not return an account.");
        if (!data.session) {
          // Email confirmation is on: no session yet, so keys can't be published.
          set({ busy: false, error: "Check your email to confirm your account, then unlock." });
          return;
        }
        userId = uid; // account uid == directory user id
      } else {
        userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      }

      // Key generation can briefly block; yield a frame so the UI can paint.
      await new Promise((r) => setTimeout(r, 10));
      const secret = createDeviceSecret();
      const meta: AccountMeta = {
        userId,
        username,
        email,
        deviceId: secret.deviceId,
        identityKey: toBase64(secret.identityEd.pub),
        createdAt: Date.now(),
      };
      const wrappingKey = await saveIdentity(secret, meta, passphrase);
      await publishDevice(secret, userId);
      syncMe(meta);
      set({ status: "unlocked", secret, meta, passphrase, busy: false });
      // Supabase sign-up already has a session, so start live messaging now.
      void startMessaging(secret, meta, wrappingKey, directory).catch(() => {});
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : "Registration failed" });
    }
  },

  unlock: async (passphrase) => {
    set({ busy: true, error: null });
    try {
      // The local encrypted key store is the authoritative gate — unlocking it
      // never depends on the network.
      const { secret, meta, wrappingKey } = await unlockIdentity(passphrase);
      syncMe(meta);
      set({ status: "unlocked", secret, meta, passphrase, busy: false });

      // Best-effort: establish a server session, refresh published keys, and
      // bring messaging online. Failure (offline) leaves the app usably unlocked.
      if (isSupabaseConfigured && supabase) {
        void (async () => {
          try {
            const password = deriveAuthPassword(meta.email, passphrase);
            const { error } = await supabase.auth.signInWithPassword({ email: meta.email.trim(), password });
            if (!error) {
              await publishDevice(secret, meta.userId);
              await startMessaging(secret, meta, wrappingKey, directory);
            }
          } catch {
            /* local unlock already succeeded; directory sync can wait */
          }
        })();
      }
    } catch (e) {
      set({ busy: false, error: e instanceof UnlockError ? "Incorrect passphrase" : "Unlock failed" });
    }
  },

  unlockWithPasskey: async () => {
    set({ busy: true, error: null });
    try {
      const passphrase = await recoverPassphraseWithPasskey();
      await get().unlock(passphrase); // runs the normal unlock path (sets state)
    } catch (e) {
      const name = (e as { name?: string }).name;
      const msg =
        name === "NotAllowedError"
          ? "Passkey cancelled or timed out."
          : e instanceof Error
            ? e.message
            : "Passkey unlock failed.";
      set({ busy: false, error: msg });
    }
  },

  enrollPasskey: async () => {
    const { meta, passphrase } = get();
    if (!meta || !passphrase) throw new Error("Unlock the app before adding a passkey.");
    await enrollPasskeyWebAuthn(meta, passphrase);
    set({ hasPasskey: true });
  },

  removePasskey: async () => {
    await removePasskeyStored();
    set({ hasPasskey: false });
  },

  lock: () => {
    stopMessaging();
    if (supabase) void supabase.auth.signOut();
    set({ status: "locked", secret: null, passphrase: null, error: null });
  },

  wipe: async () => {
    stopMessaging();
    const meta = get().meta;
    if (supabase) {
      try {
        // Best-effort: drop this device's published keys before clearing the session.
        if (meta) await supabase.from("devices").delete().eq("id", meta.deviceId);
        await supabase.auth.signOut();
      } catch {
        /* no session / offline — the local wipe below is what matters */
      }
    }
    await wipeIdentity();
    set({ status: "none", secret: null, meta: null, passphrase: null, error: null, hasPasskey: false });
  },

  clearError: () => set({ error: null }),

  fingerprint: () => {
    const s = get().secret;
    return s ? shortFingerprint(s.identityEd.pub) : null;
  },

  safetyNumberWith: async (remoteUserId) => {
    const { secret, meta } = get();
    if (!secret || !meta) return null;
    const remoteKey = await directory.identityKeyOf(remoteUserId);
    if (!remoteKey) return null;
    return computeSafetyNumber(meta.userId, secret.identityEd.pub, remoteUserId, remoteKey);
  },
}));

export { directory };
