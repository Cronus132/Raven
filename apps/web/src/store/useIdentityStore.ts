import { create } from "zustand";
import { computeSafetyNumber, createDeviceSecret, publicBundle, shortFingerprint, type DeviceSecret } from "@/lib/crypto/identity";
import { LocalKeyDirectory } from "@/lib/crypto/directory";
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
import { USERS } from "@/data/seed";
import { useChatStore } from "./useChatStore";

type Status = "loading" | "none" | "locked" | "unlocked";

// The key directory the client talks to. Local for now; swapped for the
// Supabase-backed directory once the backend is provisioned (Phase 1 backend).
const directory = new LocalKeyDirectory(Object.keys(USERS).filter((id) => id !== "me"));

interface IdentityState {
  status: Status;
  meta: AccountMeta | null;
  secret: DeviceSecret | null;
  passphrase: string | null; // in-memory only, held while unlocked to re-seal prekeys
  error: string | null;
  busy: boolean;

  init: () => Promise<void>;
  register: (input: { username: string; email: string; passphrase: string }) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
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

  init: async () => {
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
      // Key generation can briefly block; yield a frame so the UI can paint.
      await new Promise((r) => setTimeout(r, 10));
      const secret = createDeviceSecret();
      const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      const meta: AccountMeta = {
        userId,
        username,
        email,
        deviceId: secret.deviceId,
        identityKey: toBase64(secret.identityEd.pub),
        createdAt: Date.now(),
      };
      await saveIdentity(secret, meta, passphrase);
      await directory.publish(publicBundle(secret, userId));
      syncMe(meta);
      set({ status: "unlocked", secret, meta, passphrase, busy: false });
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : "Registration failed" });
    }
  },

  unlock: async (passphrase) => {
    set({ busy: true, error: null });
    try {
      const { secret, meta } = await unlockIdentity(passphrase);
      await directory.publish(publicBundle(secret, meta.userId));
      syncMe(meta);
      set({ status: "unlocked", secret, meta, passphrase, busy: false });
    } catch (e) {
      set({ busy: false, error: e instanceof UnlockError ? "Incorrect passphrase" : "Unlock failed" });
    }
  },

  lock: () => set({ status: "locked", secret: null, passphrase: null, error: null }),

  wipe: async () => {
    await wipeIdentity();
    set({ status: "none", secret: null, meta: null, passphrase: null, error: null });
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
