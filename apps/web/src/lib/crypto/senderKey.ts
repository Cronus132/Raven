/**
 * Sender Keys — the symmetric per-sender ratchet for group messages.
 *
 * Each group member derives message keys from a one-way chain (HMAC), so a
 * message is encrypted once and every member who holds the sender's chain key
 * can decrypt it. Chain keys only move forward (forward secrecy within a chain);
 * message keys are dropped after use. The sender's current chain key is
 * distributed to members over the pairwise Double Ratchet (see group.ts).
 *
 * SECURITY NOTE: this is the Sender Keys group scheme (as used by Signal group v1
 * / WhatsApp), not RFC 9420 MLS. It gives forward secrecy; full post-compromise
 * security and efficient membership changes are MLS's strength and the planned
 * upgrade (OpenMLS / core-crypto via WASM), behind this same boundary.
 */

import { aeadOpen, aeadSeal, concatBytes, hkdfSha256, hmacSha256, randomBytes, utf8 } from "./primitives";

export interface SenderChain {
  chainKey: Uint8Array;
  iteration: number;
}

export function newSenderChain(): SenderChain {
  return { chainKey: randomBytes(32), iteration: 0 };
}

function stepChain(chainKey: Uint8Array): { next: Uint8Array; messageKey: Uint8Array } {
  const messageKey = hmacSha256(chainKey, new Uint8Array([0x01]));
  const next = hmacSha256(chainKey, new Uint8Array([0x02]));
  return { next, messageKey };
}

/** Advance a sending chain, returning the message key for the (pre-advance) iteration. */
export function advanceChain(chain: SenderChain): { chain: SenderChain; messageKey: Uint8Array; iteration: number } {
  const { next, messageKey } = stepChain(chain.chainKey);
  const iteration = chain.iteration;
  return { chain: { chainKey: next, iteration: iteration + 1 }, messageKey, iteration };
}

function messageAesKey(messageKey: Uint8Array): Uint8Array {
  return hkdfSha256(messageKey, new Uint8Array(32), utf8("RavenGroupMsgKey/v1"), 32);
}

export async function sealGroup(messageKey: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const box = await aeadSeal(messageAesKey(messageKey), plaintext, aad);
  return concatBytes(box.iv, box.ciphertext);
}

export async function openGroup(messageKey: Uint8Array, body: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  return aeadOpen(messageAesKey(messageKey), { iv: body.slice(0, 12), ciphertext: body.slice(12) }, aad);
}
