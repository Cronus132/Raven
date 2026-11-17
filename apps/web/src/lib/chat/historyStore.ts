/**
 * Local encrypted message history (IndexedDB).
 *
 * The chat store (conversations, roster, decrypted messages) lives only in
 * memory, so a reload or app restart used to wipe every chat — and because the
 * relay `messages` queue is drained after delivery, there was nothing to
 * replay. This persists a snapshot of the decrypted history on-device so it
 * survives restarts.
 *
 * At rest the snapshot is sealed with AES-256-GCM under a key derived (HKDF)
 * from the keystore's passphrase-wrapping key — the same material that protects
 * the identity. Nothing readable, and no key, ever touches disk unencrypted.
 * This is purely local; it does not change the ciphertext-only server model.
 */

import {
  aeadOpen,
  aeadSeal,
  deriveWrappingKey,
  fromBase64,
  hkdfSha256,
  type SealedBox,
  sha256,
  toBase64,
  utf8,
} from "@/lib/crypto/primitives";
import type { Conversation, Message, User } from "@/types";

const DB_NAME = "raven-history";
const DB_VERSION = 1;
const STORE = "history";

export interface HistorySnapshot {
  v: 1;
  users: Record<string, User>;
  conversations: Conversation[];
  messages: Message[];
}

interface SealedRecord {
  v: 1;
  iv: string; // base64
  ciphertext: string; // base64 (sealed snapshot JSON)
}

const recordKey = (userId: string) => `hist:${userId}`;

// ---- tiny IndexedDB helper (own DB, independent of the keystore's) ----------

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

// ---- public API -------------------------------------------------------------

/** Derive a distinct at-rest key for message history from the keystore wrapping key. */
export function deriveHistoryKey(wrappingKey: Uint8Array, userId: string): Uint8Array {
  return hkdfSha256(wrappingKey, utf8(userId), utf8("raven-history-v1"), 32);
}

/**
 * Portable archive key — for the durable cross-device archive (Phase 2).
 *
 * Derived from the passphrase + a deterministic per-user salt, so EVERY one of
 * the user's devices derives the same key and can read the archive. (The local
 * history key above uses the per-device keystore wrapping key, which is not
 * portable.) The salt is not secret; strength rests on the passphrase, as it
 * already does for the local keystore. The key never leaves the device.
 */
export function deriveArchiveKey(passphrase: string, userId: string): Uint8Array {
  return deriveWrappingKey(passphrase, sha256(utf8(userId)));
}

// ---- pure codec (seal/unseal a snapshot) — unit-tested without IndexedDB ----

export async function sealSnapshot(
  userId: string,
  histKey: Uint8Array,
  snap: HistorySnapshot,
): Promise<SealedRecord> {
  const box = await aeadSeal(histKey, utf8(JSON.stringify(snap)), utf8(userId));
  return { v: 1, iv: toBase64(box.iv), ciphertext: toBase64(box.ciphertext) };
}

export async function openSnapshot(
  userId: string,
  histKey: Uint8Array,
  rec: SealedRecord,
): Promise<HistorySnapshot | null> {
  try {
    const box: SealedBox = { iv: fromBase64(rec.iv), ciphertext: fromBase64(rec.ciphertext) };
    const pt = await aeadOpen(histKey, box, utf8(userId));
    return JSON.parse(new TextDecoder().decode(pt)) as HistorySnapshot;
  } catch {
    // Wrong key (passphrase changed) or tampered/corrupt record — ignore.
    return null;
  }
}

export async function loadHistory(userId: string, histKey: Uint8Array): Promise<HistorySnapshot | null> {
  const rec = await idbGet<SealedRecord>(recordKey(userId));
  if (!rec) return null;
  return openSnapshot(userId, histKey, rec);
}

export async function saveHistory(userId: string, histKey: Uint8Array, snap: HistorySnapshot): Promise<void> {
  await idbPut(recordKey(userId), await sealSnapshot(userId, histKey, snap));
}

export async function clearHistory(userId: string): Promise<void> {
  await idbDelete(recordKey(userId));
}
