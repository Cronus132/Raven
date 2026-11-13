/**
 * Local encrypted key store (IndexedDB).
 *
 * The device secret (identity key, signed prekey, one-time prekeys) is
 * serialized and sealed with AES-256-GCM under a key derived from the user's
 * passphrase (scrypt). Only the sealed blob and non-secret display metadata
 * ever hit disk. On reload the store is *locked*: the app can show who the
 * account is, but cannot use any key until the passphrase re-derives the
 * wrapping key. Losing the passphrase (and all devices) means losing access —
 * by design.
 */

import {
  aeadOpen,
  aeadSeal,
  DEFAULT_KDF,
  deriveWrappingKey,
  fromBase64,
  type KdfParams,
  randomBytes,
  type SealedBox,
  toBase64,
} from "./primitives";

const DB_NAME = "raven";
const DB_VERSION = 1;
const STORE = "identity";
const SELF_KEY = "self";
const PASSKEY_KEY = "passkey";

export interface AccountMeta {
  userId: string;
  username: string;
  email: string;
  deviceId: string;
  identityKey: string; // base64 Ed25519 public — safe to show while locked
  createdAt: number;
}

interface StoredEnvelope {
  version: 1;
  meta: AccountMeta;
  salt: string; // base64
  kdf: KdfParams;
  iv: string; // base64
  ciphertext: string; // base64 (sealed DeviceSecret)
}

/** Passphrase sealed under a passkey's WebAuthn-PRF secret (for passkey unlock). */
export interface PasskeyEnvelope {
  version: 1;
  credentialId: string; // base64 raw credential id
  salt: string; // base64 PRF salt
  iv: string; // base64
  ciphertext: string; // base64 (sealed passphrase)
  aad: string; // userId bound as additional authenticated data
}

// ---- tiny IndexedDB helper --------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// The device secret is an opaque string (the serialized libsignal store); the
// keystore only seals/unseals it and never interprets the key material.

// ---- public API -------------------------------------------------------------

export async function loadMeta(): Promise<AccountMeta | undefined> {
  const env = await idbGet<StoredEnvelope>(SELF_KEY);
  return env?.meta;
}

export async function hasStoredIdentity(): Promise<boolean> {
  return (await idbGet<StoredEnvelope>(SELF_KEY)) !== undefined;
}

/** Seal and store the identity; returns the derived wrapping key (reused for sessions). */
export async function saveIdentity(secret: string, meta: AccountMeta, passphrase: string): Promise<Uint8Array> {
  const salt = randomBytes(16);
  const key = deriveWrappingKey(passphrase, salt, DEFAULT_KDF);
  const box = await aeadSeal(key, new TextEncoder().encode(secret), new TextEncoder().encode(meta.userId));
  const env: StoredEnvelope = {
    version: 1,
    meta,
    salt: toBase64(salt),
    kdf: DEFAULT_KDF,
    iv: toBase64(box.iv),
    ciphertext: toBase64(box.ciphertext),
  };
  await idbPut(SELF_KEY, env);
  return key;
}

/** Re-seal the stored secret with an already-derived wrapping key (no scrypt) — for
 *  frequent session-state saves. Keeps the existing salt and meta. */
export async function resealIdentity(secret: string, wrappingKey: Uint8Array): Promise<void> {
  const env = await idbGet<StoredEnvelope>(SELF_KEY);
  if (!env) return;
  const box = await aeadSeal(wrappingKey, new TextEncoder().encode(secret), new TextEncoder().encode(env.meta.userId));
  await idbPut(SELF_KEY, { ...env, iv: toBase64(box.iv), ciphertext: toBase64(box.ciphertext) });
}

export class UnlockError extends Error {
  constructor() {
    super("Incorrect passphrase");
    this.name = "UnlockError";
  }
}

export async function unlockIdentity(
  passphrase: string,
): Promise<{ secret: string; meta: AccountMeta; wrappingKey: Uint8Array }> {
  const env = await idbGet<StoredEnvelope>(SELF_KEY);
  if (!env) throw new Error("No stored identity");
  const key = deriveWrappingKey(passphrase, fromBase64(env.salt), env.kdf);
  const box: SealedBox = { iv: fromBase64(env.iv), ciphertext: fromBase64(env.ciphertext) };
  try {
    const plaintext = await aeadOpen(key, box, new TextEncoder().encode(env.meta.userId));
    return { secret: new TextDecoder().decode(plaintext), meta: env.meta, wrappingKey: key };
  } catch {
    // AEAD tag mismatch == wrong passphrase (or tampered store).
    throw new UnlockError();
  }
}

/** Re-seal an updated secret (e.g. after consuming/rotating prekeys) without changing the passphrase. */
export async function updateSecret(secret: string, passphrase: string): Promise<void> {
  const meta = await loadMeta();
  if (!meta) throw new Error("No stored identity");
  await saveIdentity(secret, meta, passphrase);
}

export async function wipeIdentity(): Promise<void> {
  // Clears the identity, passkey, and all persisted sessions.
  await idbClear();
}

// ---- persisted sessions (opaque sealed blobs, keyed by peer) -----------------

const SESSION_PREFIX = "session:";
const sessionKey = (peerUserId: string, peerDevice: string) => `${SESSION_PREFIX}${peerUserId}/${peerDevice}`;

export async function saveSessionRecord(peerUserId: string, peerDevice: string, sealed: string): Promise<void> {
  await idbPut(sessionKey(peerUserId, peerDevice), sealed);
}

export async function loadSessionRecord(peerUserId: string, peerDevice: string): Promise<string | undefined> {
  return idbGet<string>(sessionKey(peerUserId, peerDevice));
}

export async function deleteSessionRecord(peerUserId: string, peerDevice: string): Promise<void> {
  await idbDelete(sessionKey(peerUserId, peerDevice));
}

// ---- passkey envelope -------------------------------------------------------

export async function savePasskeyEnvelope(env: PasskeyEnvelope): Promise<void> {
  await idbPut(PASSKEY_KEY, env);
}

export async function loadPasskeyEnvelope(): Promise<PasskeyEnvelope | undefined> {
  return idbGet<PasskeyEnvelope>(PASSKEY_KEY);
}

export async function deletePasskeyEnvelope(): Promise<void> {
  await idbDelete(PASSKEY_KEY);
}
