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

import type { DeviceSecret, KeyPair, OneTimePreKeyRecord, SignedPreKeyRecord } from "./identity";
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

// ---- (de)serialization of the secret ---------------------------------------

const kp = (k: KeyPair) => ({ priv: toBase64(k.priv), pub: toBase64(k.pub) });
const unKp = (o: { priv: string; pub: string }): KeyPair => ({ priv: fromBase64(o.priv), pub: fromBase64(o.pub) });

function serializeSecret(s: DeviceSecret): Uint8Array {
  const json = JSON.stringify({
    version: s.version,
    registrationId: s.registrationId,
    deviceId: s.deviceId,
    createdAt: s.createdAt,
    identityEd: kp(s.identityEd),
    signedPreKey: {
      id: s.signedPreKey.id,
      keyPair: kp(s.signedPreKey.keyPair),
      signature: toBase64(s.signedPreKey.signature),
      createdAt: s.signedPreKey.createdAt,
    },
    oneTimePreKeys: s.oneTimePreKeys.map((o) => ({ id: o.id, keyPair: kp(o.keyPair) })),
  });
  return new TextEncoder().encode(json);
}

function deserializeSecret(bytes: Uint8Array): DeviceSecret {
  const o = JSON.parse(new TextDecoder().decode(bytes));
  const signedPreKey: SignedPreKeyRecord = {
    id: o.signedPreKey.id,
    keyPair: unKp(o.signedPreKey.keyPair),
    signature: fromBase64(o.signedPreKey.signature),
    createdAt: o.signedPreKey.createdAt,
  };
  const oneTimePreKeys: OneTimePreKeyRecord[] = o.oneTimePreKeys.map((x: { id: number; keyPair: { priv: string; pub: string } }) => ({
    id: x.id,
    keyPair: unKp(x.keyPair),
  }));
  return {
    version: 1,
    registrationId: o.registrationId,
    deviceId: o.deviceId,
    createdAt: o.createdAt,
    identityEd: unKp(o.identityEd),
    signedPreKey,
    oneTimePreKeys,
  };
}

// ---- public API -------------------------------------------------------------

export async function loadMeta(): Promise<AccountMeta | undefined> {
  const env = await idbGet<StoredEnvelope>(SELF_KEY);
  return env?.meta;
}

export async function hasStoredIdentity(): Promise<boolean> {
  return (await idbGet<StoredEnvelope>(SELF_KEY)) !== undefined;
}

export async function saveIdentity(secret: DeviceSecret, meta: AccountMeta, passphrase: string): Promise<void> {
  const salt = randomBytes(16);
  const key = deriveWrappingKey(passphrase, salt, DEFAULT_KDF);
  const box = await aeadSeal(key, serializeSecret(secret), new TextEncoder().encode(meta.userId));
  const env: StoredEnvelope = {
    version: 1,
    meta,
    salt: toBase64(salt),
    kdf: DEFAULT_KDF,
    iv: toBase64(box.iv),
    ciphertext: toBase64(box.ciphertext),
  };
  await idbPut(SELF_KEY, env);
}

export class UnlockError extends Error {
  constructor() {
    super("Incorrect passphrase");
    this.name = "UnlockError";
  }
}

export async function unlockIdentity(passphrase: string): Promise<{ secret: DeviceSecret; meta: AccountMeta }> {
  const env = await idbGet<StoredEnvelope>(SELF_KEY);
  if (!env) throw new Error("No stored identity");
  const key = deriveWrappingKey(passphrase, fromBase64(env.salt), env.kdf);
  const box: SealedBox = { iv: fromBase64(env.iv), ciphertext: fromBase64(env.ciphertext) };
  try {
    const plaintext = await aeadOpen(key, box, new TextEncoder().encode(env.meta.userId));
    return { secret: deserializeSecret(plaintext), meta: env.meta };
  } catch {
    // AEAD tag mismatch == wrong passphrase (or tampered store).
    throw new UnlockError();
  }
}

/** Re-seal an updated secret (e.g. after consuming/rotating prekeys) without changing the passphrase. */
export async function updateSecret(secret: DeviceSecret, passphrase: string): Promise<void> {
  const meta = await loadMeta();
  if (!meta) throw new Error("No stored identity");
  await saveIdentity(secret, meta, passphrase);
}

export async function wipeIdentity(): Promise<void> {
  await idbDelete(SELF_KEY);
  await idbDelete(PASSKEY_KEY);
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
