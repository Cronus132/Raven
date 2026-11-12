/**
 * Low-level primitives used by the crypto layer. These are thin, auditable
 * wrappers over audited implementations (@noble for curves/hashes, WebCrypto
 * for AEAD). We do NOT implement any primitive ourselves.
 *
 * Scope note: the 1:1 session (X3DH + Double Ratchet) and groups (MLS) are
 * provided by libsignal / OpenMLS later (see docs/ARCHITECTURE.md). What lives
 * here is key generation, signing, hashing, a password KDF and an AEAD used to
 * encrypt the *local* key store at rest — all standard building blocks.
 */

import { scrypt } from "@noble/hashes/scrypt";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { randomBytes } from "@noble/hashes/utils";

export { randomBytes, sha256, sha512 };

// ---- HKDF / HMAC (for the Double Ratchet KDF chains) ------------------------

export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  return hkdf(sha256, ikm, salt, info, length);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}

// ---- encoding helpers -------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** Constant-time equality for comparing key material / tags. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---- password KDF (local key-store wrapping key) ----------------------------

export interface KdfParams {
  N: number;
  r: number;
  p: number;
  dkLen: number;
}

// scrypt cost tuned for an interactive unlock in-browser. The *server* login
// credential uses Argon2id separately (see backend); this is only for wrapping
// the on-device key store.
export const DEFAULT_KDF: KdfParams = { N: 2 ** 16, r: 8, p: 1, dkLen: 32 };

export function deriveWrappingKey(passphrase: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Uint8Array {
  return scrypt(utf8(passphrase.normalize("NFKC")), salt, params);
}

// ---- AEAD (AES-256-GCM via WebCrypto) ---------------------------------------

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  // Copy into a fresh ArrayBuffer so we never hand WebCrypto a view with an offset.
  return crypto.subtle.importKey("raw", raw.slice(), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export interface SealedBox {
  iv: Uint8Array;
  ciphertext: Uint8Array; // includes the GCM tag
}

export async function aeadSeal(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<SealedBox> {
  const iv = randomBytes(12);
  const ck = await importAesKey(key);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, ck, plaintext.slice());
  return { iv, ciphertext: new Uint8Array(ct) };
}

export async function aeadOpen(key: Uint8Array, box: SealedBox, aad?: Uint8Array): Promise<Uint8Array> {
  const ck = await importAesKey(key);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: box.iv.slice(), additionalData: aad },
    ck,
    box.ciphertext.slice(),
  );
  return new Uint8Array(pt);
}
