import { create } from "zustand";
import { shortFingerprint } from "@/lib/crypto/identity";
import { LocalKeyDirectory, type KeyDirectory } from "@/lib/crypto/directory";
import { SupabaseKeyDirectory } from "@/lib/crypto/supabaseDirectory";
import {
  createSignalDevice,
  signalSafetyNumber,
  type SignalPublicBundle,
} from "@/lib/crypto/signal/signalDevice";
import { SignalStore } from "@/lib/crypto/signal/signalStore";
import { SignalSessionEngine } from "@/lib/crypto/sessionEngine";
import {
  type AccountMeta,
  hasStoredIdentity,
  loadMeta,
  resealIdentity,
  saveIdentity,
  UnlockError,
  unlockIdentity,
  wipeIdentity,
} from "@/lib/crypto/keystore";
import { fromBase64, toBase64 } from "@/lib/crypto/primitives";
import {
  enrollPasskey as enrollPasskeyWebAuthn,
  hasPasskey as hasPasskeyStored,
  passkeysAvailable,
  recoverPassphraseWithPasskey,
  removePasskey as removePasskeyStored,
} from "@/lib/crypto/passkey";
import { supabase, isSupabaseConfigured, deriveAuthPassword } from "@/lib/backend/supabase";
import { startMessaging, stopMessaging } from "@/lib/chat/liveMessaging";
import { startHistoryPersistence, stopHistoryPersistence, wipeHistory } from "@/lib/chat/historyPersistence";
import { startArchiveSync, stopArchiveSync } from "@/lib/chat/archiveSync";
import * as biometric from "@/lib/native/biometric";
import { USERS } from "@/data/seed";
import { useChatStore } from "./useChatStore";

type Status = "loading" | "none" | "locked" | "unlocked";

/** This device's libsignal identity: the store (keys + sessions), its public bundle, and id. */
interface Device {
  store: SignalStore;
  bundle: SignalPublicBundle;
  deviceId: string;
}

const demoIds = Object.keys(USERS).filter((id) => id !== "me");
const directory: KeyDirectory = isSupabaseConfigured
  ? new SupabaseKeyDirectory(demoIds)
  : new LocalKeyDirectory(demoIds);

function serializeDevice(d: Device): string {
  return JSON.stringify({ store: d.store.serialize(), bundle: d.bundle, deviceId: d.deviceId });
}
function deserializeDevice(s: string): Device {
  const o = JSON.parse(s) as { store: string; bundle: SignalPublicBundle; deviceId: string };
  return { store: SignalStore.deserialize(o.store), bundle: o.bundle, deviceId: o.deviceId };
}

/** Build the session engine, persisting the store (cheaply) whenever it changes. */
function buildEngine(device: Device, wrappingKey: Uint8Array): SignalSessionEngine {
  const persist = () => void resealIdentity(serializeDevice(device), wrappingKey).catch(() => {});
  return new SignalSessionEngine(device.store, device.deviceId, device.bundle.identityKey, persist);
}

async function publishDevice(bundle: SignalPublicBundle, userId: string, deviceId: string): Promise<void> {
  await directory.publishSignalBundle?.(bundle, userId, deviceId);
}

/** Reject after `ms` so a hung backend (e.g. an auth outage) can't wedge the
 *  form with busy=true forever. The underlying request may still settle later;
 *  we just stop waiting and surface a retryable error. */
const AUTH_TIMEOUT_MS = 20_000;
function withTimeout<T>(p: PromiseLike<T>, label: string, ms = AUTH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out — the server may be unreachable. Please try again.`)), ms),
    ),
  ]);
}

function mapAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered"))
    return "That email already has an account — unlock it, or use another email.";
  if (m.includes("database error")) return "Couldn't create the account (that username may be taken). Try a different username.";
  if (m.includes("password")) return "The server rejected that passphrase. Use a longer one.";
  return msg;
}

interface IdentityState {
  status: Status;
  meta: AccountMeta | null;
  device: Device | null;
  passphrase: string | null;
  error: string | null;
  busy: boolean;
  passkeySupported: boolean;
  hasPasskey: boolean;
  biometricSupported: boolean;
  hasBiometric: boolean;

  init: () => Promise<void>;
  register: (input: { username: string; email: string; passphrase: string }) => Promise<void>;
  signIn: (input: { email: string; passphrase: string }) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  unlockWithPasskey: () => Promise<void>;
  enrollPasskey: () => Promise<void>;
  removePasskey: () => Promise<void>;
  unlockWithBiometric: () => Promise<void>;
  enrollBiometric: () => Promise<void>;
  removeBiometric: () => Promise<void>;
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
  device: null,
  passphrase: null,
  error: null,
  busy: false,
  passkeySupported: false,
  hasPasskey: false,
  biometricSupported: false,
  hasBiometric: false,

  init: async () => {
    // Decide the gate FIRST and never block it on capability probing. A hung
    // native call (e.g. a biometric probe that never resolves) must not keep the
    // app stuck on the splash screen — otherwise the status never leaves
    // "loading" and nothing renders.
    try {
      if (await hasStoredIdentity()) {
        set({ status: "locked", meta: (await loadMeta()) ?? null });
      } else {
        set({ status: "none" });
      }
    } catch {
      set({ status: "none" });
    }

    // Probe unlock capabilities in the background; update the flags if/when they
    // resolve. These are timeout-guarded and never throw.
    void Promise.all([passkeysAvailable().catch(() => false), hasPasskeyStored().catch(() => false)]).then(
      ([supported, hasPk]) => set({ passkeySupported: supported, hasPasskey: hasPk }),
    );
    void Promise.all([biometric.biometricAvailable(), biometric.hasBiometricCredential()]).then(
      ([bioSupported, hasBio]) => set({ biometricSupported: bioSupported, hasBiometric: hasBio }),
    );
  },

  register: async ({ username, email, passphrase }) => {
    set({ busy: true, error: null });
    try {
      let userId: string;
      if (isSupabaseConfigured && supabase) {
        const password = deriveAuthPassword(email, passphrase);
        const { data, error } = await withTimeout(
          supabase.auth.signUp({ email: email.trim(), password, options: { data: { username } } }),
          "Sign-up",
        );
        if (error) throw new Error(mapAuthError(error.message));
        const uid = data.user?.id;
        if (!uid) throw new Error("Sign-up did not return an account.");
        if (!data.session) {
          set({ busy: false, error: "Check your email to confirm your account, then unlock." });
          return;
        }
        userId = uid;
      } else {
        userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      }

      await new Promise((r) => setTimeout(r, 10));
      const dev = await createSignalDevice();
      const device: Device = { store: dev.store, bundle: dev.bundle, deviceId: `sdev_${crypto.randomUUID().slice(0, 8)}` };
      const meta: AccountMeta = {
        userId,
        username,
        email,
        deviceId: device.deviceId,
        identityKey: device.bundle.identityKey,
        createdAt: Date.now(),
      };
      const wrappingKey = await saveIdentity(serializeDevice(device), meta, passphrase);
      await publishDevice(device.bundle, userId, device.deviceId);
      syncMe(meta);
      set({ status: "unlocked", device, meta, passphrase, busy: false });
      void startHistoryPersistence(userId, wrappingKey).catch(() => {});
      void startArchiveSync(userId, passphrase).catch(() => {});
      void startMessaging(buildEngine(device, wrappingKey), meta, directory).catch(() => {});
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : "Registration failed" });
    }
  },

  signIn: async ({ email, passphrase }) => {
    set({ busy: true, error: null });
    try {
      if (!(isSupabaseConfigured && supabase)) throw new Error("Sign-in needs the backend configured.");
      const password = deriveAuthPassword(email, passphrase);
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        "Sign-in",
      );
      if (error || !data.user) throw new Error("Incorrect email or passphrase.");
      const uid = data.user.id;
      const username = (await directory.usernameOf?.(uid)) ?? email.split("@")[0];
      await new Promise((r) => setTimeout(r, 10));
      const dev = await createSignalDevice();
      const device: Device = { store: dev.store, bundle: dev.bundle, deviceId: `sdev_${crypto.randomUUID().slice(0, 8)}` };
      const meta: AccountMeta = {
        userId: uid,
        username,
        email,
        deviceId: device.deviceId,
        identityKey: device.bundle.identityKey,
        createdAt: Date.now(),
      };
      const wrappingKey = await saveIdentity(serializeDevice(device), meta, passphrase);
      await publishDevice(device.bundle, uid, device.deviceId);
      syncMe(meta);
      set({ status: "unlocked", device, meta, passphrase, busy: false });
      void startHistoryPersistence(uid, wrappingKey).catch(() => {});
      void startArchiveSync(uid, passphrase).catch(() => {});
      void startMessaging(buildEngine(device, wrappingKey), meta, directory).catch(() => {});
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : "Sign-in failed" });
    }
  },

  unlock: async (passphrase) => {
    set({ busy: true, error: null });
    try {
      const { secret, meta, wrappingKey } = await unlockIdentity(passphrase);
      const device = deserializeDevice(secret);
      syncMe(meta);
      set({ status: "unlocked", device, meta, passphrase, busy: false });
      void startHistoryPersistence(meta.userId, wrappingKey).catch(() => {});

      if (isSupabaseConfigured && supabase) {
        void (async () => {
          try {
            const password = deriveAuthPassword(meta.email, passphrase);
            const { error } = await supabase.auth.signInWithPassword({ email: meta.email.trim(), password });
            if (!error) {
              await publishDevice(device.bundle, meta.userId, device.deviceId);
              void startArchiveSync(meta.userId, passphrase).catch(() => {});
              await startMessaging(buildEngine(device, wrappingKey), meta, directory);
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
      await get().unlock(passphrase);
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

  unlockWithBiometric: async () => {
    set({ busy: true, error: null });
    try {
      const passphrase = await biometric.biometricUnlock();
      await get().unlock(passphrase);
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : "Biometric unlock failed." });
    }
  },

  enrollBiometric: async () => {
    const { meta, passphrase } = get();
    if (!meta || !passphrase) throw new Error("Unlock the app before adding biometrics.");
    await biometric.enrollBiometric(meta.username, passphrase);
    set({ hasBiometric: true });
  },

  removeBiometric: async () => {
    await biometric.removeBiometric();
    set({ hasBiometric: false });
  },

  lock: () => {
    stopMessaging();
    stopHistoryPersistence();
    stopArchiveSync();
    if (supabase) void supabase.auth.signOut();
    set({ status: "locked", device: null, passphrase: null, error: null });
  },

  wipe: async () => {
    stopMessaging();
    // Stop syncing, but leave the server archive intact — it's the user's
    // cross-device backup; wiping this device shouldn't erase it everywhere.
    stopArchiveSync();
    const meta = get().meta;
    if (meta) await wipeHistory(meta.userId);
    if (supabase) {
      try {
        if (meta) await supabase.from("devices").delete().eq("id", meta.deviceId);
        await supabase.auth.signOut();
      } catch {
        /* no session / offline — the local wipe below is what matters */
      }
    }
    await wipeIdentity();
    useChatStore.getState().resetChat();
    set({ status: "none", device: null, meta: null, passphrase: null, error: null, hasPasskey: false });
  },

  clearError: () => set({ error: null }),

  fingerprint: () => {
    const meta = get().meta;
    return meta ? shortFingerprint(fromBase64(meta.identityKey)) : null;
  },

  safetyNumberWith: async (remoteUserId) => {
    const meta = get().meta;
    if (!meta) return null;
    const remoteKey = await directory.identityKeyOf(remoteUserId);
    if (!remoteKey) return null;
    return signalSafetyNumber(meta.userId, meta.identityKey, remoteUserId, toBase64(remoteKey));
  },
}));

export { directory };
