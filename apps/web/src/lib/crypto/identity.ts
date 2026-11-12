/**
 * Device identity and prekeys.
 *
 * Each device owns a long-term identity key (Ed25519 — the stable cryptographic
 * identity shown in safety numbers and used to sign prekeys), plus a rotating
 * signed prekey and a batch of one-time prekeys (X25519, for key agreement).
 * Private keys never leave the device; only the public `PreKeyBundle` is
 * published to the key directory.
 *
 * In Phase 2 the X3DH + Double Ratchet session layer (libsignal) consumes these
 * public bundles. This module owns generation, rotation, signing and the
 * displayable safety number.
 */

import { ed25519, x25519, edwardsToMontgomeryPub } from "@noble/curves/ed25519";
import type { PreKeyBundle } from "./engine";
import { concatBytes, randomBytes, sha512, utf8 } from "./primitives";

export interface KeyPair {
  priv: Uint8Array;
  pub: Uint8Array;
}

export interface SignedPreKeyRecord {
  id: number;
  keyPair: KeyPair; // X25519
  signature: Uint8Array; // Ed25519 signature over keyPair.pub
  createdAt: number;
}

export interface OneTimePreKeyRecord {
  id: number;
  keyPair: KeyPair; // X25519
}

/** The full on-device secret state. Serialized, encrypted and stored locally. */
export interface DeviceSecret {
  version: 1;
  registrationId: number;
  deviceId: string;
  createdAt: number;
  identityEd: KeyPair; // Ed25519 long-term identity (priv is the 32-byte seed)
  signedPreKey: SignedPreKeyRecord;
  oneTimePreKeys: OneTimePreKeyRecord[];
}

const FINGERPRINT_VERSION = 0;
const FINGERPRINT_ITERATIONS = 5200;

function randomRegistrationId(): number {
  // 14-bit registration id, matching Signal's range (1..16383).
  return (randomBytes(2)[0] | (randomBytes(1)[0] << 8)) % 16383 + 1;
}

function genEd25519(): KeyPair {
  const priv = ed25519.utils.randomPrivateKey();
  return { priv, pub: ed25519.getPublicKey(priv) };
}

function genX25519(): KeyPair {
  const priv = x25519.utils.randomPrivateKey();
  return { priv, pub: x25519.getPublicKey(priv) };
}

function makeSignedPreKey(identityEd: KeyPair, id: number): SignedPreKeyRecord {
  const keyPair = genX25519();
  const signature = ed25519.sign(keyPair.pub, identityEd.priv);
  return { id, keyPair, signature, createdAt: Date.now() };
}

function makeOneTimePreKeys(count: number, startId: number): OneTimePreKeyRecord[] {
  const out: OneTimePreKeyRecord[] = [];
  for (let i = 0; i < count; i++) out.push({ id: startId + i, keyPair: genX25519() });
  return out;
}

/** Create a brand-new device identity with an initial set of prekeys. */
export function createDeviceSecret(oneTimeCount = 100): DeviceSecret {
  const identityEd = genEd25519();
  return {
    version: 1,
    registrationId: randomRegistrationId(),
    deviceId: `dev_${crypto.randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    identityEd,
    signedPreKey: makeSignedPreKey(identityEd, 1),
    oneTimePreKeys: makeOneTimePreKeys(oneTimeCount, 1),
  };
}

/** Verify a signed prekey's signature against a published identity key. */
export function verifySignedPreKey(bundle: PreKeyBundle): boolean {
  return ed25519.verify(bundle.signedPreKeySignature, bundle.signedPreKey, bundle.identityKey);
}

/** Build the public bundle to publish, consuming one one-time prekey if present. */
export function publicBundle(secret: DeviceSecret, userId: string): PreKeyBundle {
  const otk = secret.oneTimePreKeys[0];
  return {
    userId,
    deviceId: secret.deviceId,
    identityKey: secret.identityEd.pub,
    signedPreKey: secret.signedPreKey.keyPair.pub,
    signedPreKeySignature: secret.signedPreKey.signature,
    oneTimePreKey: otk?.keyPair.pub,
    registrationId: secret.registrationId,
  };
}

/** X25519 (Montgomery) form of the identity key, for key agreement. */
export function identityAgreementKey(secret: DeviceSecret): Uint8Array {
  return edwardsToMontgomeryPub(secret.identityEd.pub);
}

// ---- Safety number ----------------------------------------------------------

/** One party's 30-digit fingerprint: iterated hash of identity key + stable id. */
function scannableFingerprint(identityKey: Uint8Array, stableId: string): Uint8Array {
  let hash = concatBytes(new Uint8Array([FINGERPRINT_VERSION]), identityKey, utf8(stableId));
  for (let i = 0; i < FINGERPRINT_ITERATIONS; i++) {
    hash = sha512(concatBytes(hash, identityKey));
  }
  return hash.slice(0, 30);
}

/** Encode 30 bytes as six groups of five decimal digits (Signal-style). */
function encodeFingerprint(bytes: Uint8Array): string {
  const groups: string[] = [];
  for (let i = 0; i < 30; i += 5) {
    // big-endian 40-bit chunk -> 5 decimal digits
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + bytes[i + j];
    groups.push((n % 100000).toString().padStart(5, "0"));
  }
  return groups.join(" ");
}

/**
 * Displayable safety number for a conversation: the two parties' fingerprints,
 * ordered deterministically so both sides render identical digits. Compare
 * out-of-band to defend against a key-substituting server (MITM at first
 * contact).
 */
export function computeSafetyNumber(
  localId: string,
  localIdentityKey: Uint8Array,
  remoteId: string,
  remoteIdentityKey: Uint8Array,
): string {
  const local = encodeFingerprint(scannableFingerprint(localIdentityKey, localId));
  const remote = encodeFingerprint(scannableFingerprint(remoteIdentityKey, remoteId));
  const [a, b] = [`${localId}:${local}`, `${remoteId}:${remote}`].sort();
  return `${a.split(":")[1]} ${b.split(":")[1]}`.replace(/\s+/g, " ").trim();
}

/** Short hex fingerprint of an identity key, for compact device displays. */
export function shortFingerprint(identityKey: Uint8Array): string {
  const h = sha512(identityKey).slice(0, 8);
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("").replace(/(.{4})/g, "$1 ").trim();
}
