/**
 * Double Ratchet (Signal spec) over audited primitives.
 *
 * Implemented to the Signal "Double Ratchet" specification using @noble X25519
 * for the DH ratchet, HKDF-SHA256 for the root KDF, HMAC-SHA256 for the symmetric
 * chains, and AES-256-GCM (WebCrypto) for message encryption. We do NOT implement
 * any primitive here — only the protocol that composes them.
 *
 * Properties this provides: per-message forward secrecy (chain keys are one-way
 * and message keys are dropped after use) and post-compromise security (each new
 * message from the peer triggers a DH ratchet that heals the session).
 *
 * SECURITY NOTE: this is a spec-faithful implementation pending audit. The plan
 * is to swap it for libsignal (Rust→WASM) behind the same boundary before any
 * real-world use. See docs/ARCHITECTURE.md.
 */

import { x25519 } from "@noble/curves/ed25519";
import { aeadOpen, aeadSeal, concatBytes, hkdfSha256, hmacSha256, utf8 } from "./primitives";

const MAX_SKIP = 1000; // most skipped message keys we'll store per chain step

export interface RatchetKeyPair {
  priv: Uint8Array; // X25519
  pub: Uint8Array;
}

export interface RatchetHeader {
  dh: Uint8Array; // sender's current ratchet public key
  pn: number; // number of messages in the previous sending chain
  n: number; // message number in the current sending chain
}

export interface RatchetState {
  rootKey: Uint8Array;
  dhSelf: RatchetKeyPair; // DHs
  dhRemote: Uint8Array | null; // DHr (public)
  sendChain: Uint8Array | null; // CKs
  recvChain: Uint8Array | null; // CKr
  sendN: number; // Ns
  recvN: number; // Nr
  prevN: number; // PN
  skipped: Map<string, Uint8Array>; // "<dhRemoteHex>:<n>" -> message key
  ad: Uint8Array; // associated data (bound into every AEAD)
}

export function generateRatchetKeyPair(): RatchetKeyPair {
  const priv = x25519.utils.randomPrivateKey();
  return { priv, pub: x25519.getPublicKey(priv) };
}

function dh(self: RatchetKeyPair, remotePub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(self.priv, remotePub);
}

// Root KDF: HKDF(salt=rootKey, ikm=dhOut) -> (rootKey', chainKey)
function kdfRoot(rootKey: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdfSha256(dhOut, rootKey, utf8("RavenRootKDF/v1"), 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

// Chain KDF: messageKey = HMAC(ck, 0x01), chainKey' = HMAC(ck, 0x02)
function kdfChain(chainKey: Uint8Array): [Uint8Array, Uint8Array] {
  const messageKey = hmacSha256(chainKey, new Uint8Array([0x01]));
  const nextChainKey = hmacSha256(chainKey, new Uint8Array([0x02]));
  return [nextChainKey, messageKey];
}

// Derive the AES-256-GCM key from a (single-use) message key. The IV is random
// per message (safe because the key is never reused) and travels with the body.
function messageKeyToAesKey(messageKey: Uint8Array): Uint8Array {
  return hkdfSha256(messageKey, new Uint8Array(32), utf8("RavenMsgKey/v1"), 32);
}

function serializeHeader(h: RatchetHeader): Uint8Array {
  const meta = new Uint8Array(8);
  new DataView(meta.buffer).setUint32(0, h.pn, false);
  new DataView(meta.buffer).setUint32(4, h.n, false);
  return concatBytes(h.dh, meta);
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Initiator (Alice): starts with the shared secret and the peer's initial ratchet key. */
export function initRatchetInitiator(sharedSecret: Uint8Array, ad: Uint8Array, remoteRatchetKey: Uint8Array): RatchetState {
  const dhSelf = generateRatchetKeyPair();
  const [rootKey, sendChain] = kdfRoot(sharedSecret, dh(dhSelf, remoteRatchetKey));
  return {
    rootKey,
    dhSelf,
    dhRemote: remoteRatchetKey,
    sendChain,
    recvChain: null,
    sendN: 0,
    recvN: 0,
    prevN: 0,
    skipped: new Map(),
    ad,
  };
}

/** Responder (Bob): starts with the shared secret and his own signed-prekey keypair as the first ratchet key. */
export function initRatchetResponder(sharedSecret: Uint8Array, ad: Uint8Array, selfRatchetKey: RatchetKeyPair): RatchetState {
  return {
    rootKey: sharedSecret,
    dhSelf: selfRatchetKey,
    dhRemote: null,
    sendChain: null,
    recvChain: null,
    sendN: 0,
    recvN: 0,
    prevN: 0,
    skipped: new Map(),
    ad,
  };
}

export async function ratchetEncrypt(state: RatchetState, plaintext: Uint8Array): Promise<{ header: RatchetHeader; body: Uint8Array }> {
  if (!state.sendChain) throw new Error("ratchet: no sending chain");
  const [nextChain, messageKey] = kdfChain(state.sendChain);
  state.sendChain = nextChain;
  const header: RatchetHeader = { dh: state.dhSelf.pub, pn: state.prevN, n: state.sendN };
  state.sendN += 1;

  const key = messageKeyToAesKey(messageKey);
  const aad = concatBytes(state.ad, serializeHeader(header));
  const box = await aeadSeal(key, plaintext, aad);
  // Pack iv + ciphertext so decrypt is self-contained.
  return { header, body: concatBytes(box.iv, box.ciphertext) };
}

function skipMessageKeys(state: RatchetState, until: number): void {
  if (!state.recvChain) return;
  if (state.recvN + MAX_SKIP < until) throw new Error("ratchet: too many skipped messages");
  while (state.recvN < until) {
    const [nextChain, messageKey] = kdfChain(state.recvChain);
    state.recvChain = nextChain;
    if (state.dhRemote) state.skipped.set(`${toHex(state.dhRemote)}:${state.recvN}`, messageKey);
    state.recvN += 1;
  }
}

function dhRatchet(state: RatchetState, header: RatchetHeader): void {
  state.prevN = state.sendN;
  state.sendN = 0;
  state.recvN = 0;
  state.dhRemote = header.dh;
  [state.rootKey, state.recvChain] = kdfRoot(state.rootKey, dh(state.dhSelf, state.dhRemote));
  state.dhSelf = generateRatchetKeyPair();
  [state.rootKey, state.sendChain] = kdfRoot(state.rootKey, dh(state.dhSelf, state.dhRemote));
}

export async function ratchetDecrypt(state: RatchetState, header: RatchetHeader, body: Uint8Array): Promise<Uint8Array> {
  const iv = body.slice(0, 12);
  const ciphertext = body.slice(12);
  const aad = concatBytes(state.ad, serializeHeader(header));

  // 1) a skipped (out-of-order) message key?
  const skippedId = `${toHex(header.dh)}:${header.n}`;
  const skippedKey = state.skipped.get(skippedId);
  if (skippedKey) {
    state.skipped.delete(skippedId);
    const key = messageKeyToAesKey(skippedKey);
    return aeadOpen(key, { iv, ciphertext }, aad);
  }

  // 2) new ratchet key from the peer -> DH ratchet step
  if (!state.dhRemote || toHex(header.dh) !== toHex(state.dhRemote)) {
    skipMessageKeys(state, header.pn); // finish the previous receiving chain
    dhRatchet(state, header);
  }

  // 3) advance the receiving chain to this message
  skipMessageKeys(state, header.n);
  if (!state.recvChain) throw new Error("ratchet: no receiving chain");
  const [nextChain, messageKey] = kdfChain(state.recvChain);
  state.recvChain = nextChain;
  state.recvN += 1;

  const key = messageKeyToAesKey(messageKey);
  return aeadOpen(key, { iv, ciphertext }, aad);
}
