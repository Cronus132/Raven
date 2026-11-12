/**
 * X3DH (Extended Triple Diffie-Hellman) initial key agreement — Signal spec,
 * over audited @noble primitives.
 *
 * Alice (initiator) fetches Bob's prekey bundle and derives a shared secret from
 * four DHs (IK_A·SPK_B, EK_A·IK_B, EK_A·SPK_B, EK_A·OPK_B); Bob (responder)
 * reconstructs the same secret from Alice's identity + ephemeral keys. The
 * identity keys are Ed25519 (for signatures) and are converted to X25519 for the
 * agreement. The result seeds the Double Ratchet.
 *
 * SECURITY NOTE: spec-faithful, audit-pending; to be replaced by libsignal.
 */

import { ed25519, x25519, edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from "@noble/curves/ed25519";
import type { DeviceSecret, KeyPair } from "./identity";
import { concatBytes, hkdfSha256, utf8 } from "./primitives";

/** A prekey bundle with the key ids resolved (as returned by the directory's claim RPC). */
export interface ResolvedPreKeyBundle {
  identityKey: Uint8Array; // Ed25519 public identity key
  signedPreKey: Uint8Array; // X25519 public
  signedPreKeyId: number;
  signedPreKeySignature: Uint8Array;
  oneTimePreKey?: Uint8Array; // X25519 public (absent if the pool ran out)
  oneTimePreKeyId?: number;
  registrationId: number;
}

/** Sent with the first message(s) so the responder can derive the same secret. */
export interface X3DHPreamble {
  identityKey: Uint8Array; // Alice's Ed25519 identity public
  ephemeralKey: Uint8Array; // Alice's X25519 ephemeral public
  signedPreKeyId: number; // which of Bob's signed prekeys was used
  oneTimePreKeyId?: number; // which of Bob's one-time prekeys was used (if any)
}

// Per the X3DH spec for X25519: prepend 32 0xFF bytes before the DH outputs.
const KDF_PREFIX = new Uint8Array(32).fill(0xff);

function deriveSecret(dhOutputs: Uint8Array[]): Uint8Array {
  const ikm = concatBytes(KDF_PREFIX, ...dhOutputs);
  return hkdfSha256(ikm, new Uint8Array(32), utf8("RavenX3DH/v1"), 32);
}

/** Associated data bound into the ratchet: both identity keys, initiator first. */
export function associatedData(aliceIdentityPub: Uint8Array, bobIdentityPub: Uint8Array): Uint8Array {
  return concatBytes(aliceIdentityPub, bobIdentityPub);
}

export interface InitiatorX3DH {
  sharedSecret: Uint8Array;
  preamble: X3DHPreamble;
  ad: Uint8Array;
  remoteRatchetKey: Uint8Array; // Bob's signed prekey — Alice's initial ratchet peer key
}

export function x3dhInitiator(alice: DeviceSecret, bob: ResolvedPreKeyBundle): InitiatorX3DH {
  if (!ed25519.verify(bob.signedPreKeySignature, bob.signedPreKey, bob.identityKey)) {
    throw new Error("x3dh: signed prekey signature is invalid");
  }
  const ikaPriv = edwardsToMontgomeryPriv(alice.identityEd.priv);
  const ikbPub = edwardsToMontgomeryPub(bob.identityKey);
  const ekPriv = x25519.utils.randomPrivateKey();
  const ekPub = x25519.getPublicKey(ekPriv);

  const dhOutputs = [
    x25519.getSharedSecret(ikaPriv, bob.signedPreKey), // DH1: IK_A · SPK_B
    x25519.getSharedSecret(ekPriv, ikbPub), // DH2: EK_A · IK_B
    x25519.getSharedSecret(ekPriv, bob.signedPreKey), // DH3: EK_A · SPK_B
  ];
  if (bob.oneTimePreKey) dhOutputs.push(x25519.getSharedSecret(ekPriv, bob.oneTimePreKey)); // DH4: EK_A · OPK_B

  return {
    sharedSecret: deriveSecret(dhOutputs),
    preamble: {
      identityKey: alice.identityEd.pub,
      ephemeralKey: ekPub,
      signedPreKeyId: bob.signedPreKeyId,
      oneTimePreKeyId: bob.oneTimePreKeyId,
    },
    ad: associatedData(alice.identityEd.pub, bob.identityKey),
    remoteRatchetKey: bob.signedPreKey,
  };
}

export interface ResponderX3DH {
  sharedSecret: Uint8Array;
  ad: Uint8Array;
  selfRatchetKey: KeyPair; // Bob's signed prekey keypair — his initial ratchet key
}

export function x3dhResponder(bob: DeviceSecret, preamble: X3DHPreamble): ResponderX3DH {
  if (preamble.signedPreKeyId !== bob.signedPreKey.id) throw new Error("x3dh: unknown signed prekey id");
  const spk = bob.signedPreKey.keyPair;

  let otk: KeyPair | undefined;
  if (preamble.oneTimePreKeyId !== undefined) {
    const rec = bob.oneTimePreKeys.find((o) => o.id === preamble.oneTimePreKeyId);
    if (!rec) throw new Error("x3dh: unknown one-time prekey id");
    otk = rec.keyPair;
  }

  const ikbPriv = edwardsToMontgomeryPriv(bob.identityEd.priv);
  const ikaPub = edwardsToMontgomeryPub(preamble.identityKey);

  const dhOutputs = [
    x25519.getSharedSecret(spk.priv, ikaPub), // DH1
    x25519.getSharedSecret(ikbPriv, preamble.ephemeralKey), // DH2
    x25519.getSharedSecret(spk.priv, preamble.ephemeralKey), // DH3
  ];
  if (otk) dhOutputs.push(x25519.getSharedSecret(otk.priv, preamble.ephemeralKey)); // DH4

  return {
    sharedSecret: deriveSecret(dhOutputs),
    ad: associatedData(preamble.identityKey, bob.identityEd.pub),
    selfRatchetKey: spk,
  };
}
