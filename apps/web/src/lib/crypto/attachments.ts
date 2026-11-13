/**
 * Attachment encryption. Each attachment gets its own random AES-256-GCM key;
 * the ciphertext blob is uploaded to storage and the key travels only inside the
 * E2E-encrypted message. The server stores ciphertext bytes it cannot read.
 */

import { aeadOpen, aeadSeal, fromBase64, randomBytes, toBase64 } from "./primitives";

export interface EncryptedBlob {
  ciphertext: Uint8Array;
  key: string; // base64 AES-256 key
  iv: string; // base64
}

export async function encryptBytes(bytes: Uint8Array): Promise<EncryptedBlob> {
  const key = randomBytes(32);
  const box = await aeadSeal(key, bytes);
  return { ciphertext: box.ciphertext, key: toBase64(key), iv: toBase64(box.iv) };
}

export async function decryptBytes(ciphertext: Uint8Array, keyB64: string, ivB64: string): Promise<Uint8Array> {
  return aeadOpen(fromBase64(keyB64), { iv: fromBase64(ivB64), ciphertext });
}
