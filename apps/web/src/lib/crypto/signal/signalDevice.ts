/**
 * libsignal-protocol device + session helpers (behind the app's crypto boundary).
 *
 * Generates a device's libsignal identity + pre-keys, derives the public bundle
 * to publish, establishes X3DH sessions from a peer's claimed bundle, and
 * encrypts/decrypts with the Double Ratchet. Ratchet state lives inside the
 * SignalStore (persisted via the encrypted keystore). This is the real Signal
 * protocol implementation that replaces the spec-faithful @noble ratchet.
 */

import {
  FingerprintGenerator,
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from "@privacyresearch/libsignal-protocol-typescript";
import { SignalStore } from "./signalStore";
import { fromBase64, toBase64 } from "../primitives";

const b64 = (ab: ArrayBuffer) => toBase64(new Uint8Array(ab));
const unb64 = (s: string) => fromBase64(s).buffer as ArrayBuffer;
const toAB = (u8: Uint8Array): ArrayBuffer => u8.slice().buffer;

export interface SignalPublicBundle {
  registrationId: number;
  identityKey: string; // base64
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKeys: { keyId: number; publicKey: string }[];
}

/** One claimed prekey bundle (as the directory's claim returns it). */
export interface ClaimedSignalBundle {
  registrationId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKeyId?: number;
  oneTimePreKey?: string;
}

export function addressOf(userId: string, deviceId: string): SignalProtocolAddress {
  return new SignalProtocolAddress(`${userId}/${deviceId}`, 1);
}

/** Create a fresh device: identity + signed prekey + a pool of one-time prekeys. */
export async function createSignalDevice(oneTimeCount = 100): Promise<{ store: SignalStore; bundle: SignalPublicBundle }> {
  const identity = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const store = new SignalStore();
  store.setIdentity(identity, registrationId);

  const signed = await KeyHelper.generateSignedPreKey(identity, 1);
  await store.storeSignedPreKey(1, signed.keyPair);

  const oneTimePreKeys: { keyId: number; publicKey: string }[] = [];
  for (let i = 1; i <= oneTimeCount; i++) {
    const pk = await KeyHelper.generatePreKey(i);
    await store.storePreKey(i, pk.keyPair);
    oneTimePreKeys.push({ keyId: i, publicKey: b64(pk.keyPair.pubKey) });
  }

  return {
    store,
    bundle: {
      registrationId,
      identityKey: b64(identity.pubKey),
      signedPreKeyId: 1,
      signedPreKey: b64(signed.keyPair.pubKey),
      signedPreKeySignature: b64(signed.signature),
      oneTimePreKeys,
    },
  };
}

export async function identityKeyB64(store: SignalStore): Promise<string> {
  const kp = await store.getIdentityKeyPair();
  if (!kp) throw new Error("no identity");
  return b64(kp.pubKey);
}

/** Establish an outgoing session to a peer device from its claimed bundle. */
export async function establishSession(
  store: SignalStore,
  address: SignalProtocolAddress,
  claimed: ClaimedSignalBundle,
): Promise<void> {
  const bundle = {
    identityKey: unb64(claimed.identityKey),
    registrationId: claimed.registrationId,
    signedPreKey: {
      keyId: claimed.signedPreKeyId,
      publicKey: unb64(claimed.signedPreKey),
      signature: unb64(claimed.signedPreKeySignature),
    },
    preKey:
      claimed.oneTimePreKey && claimed.oneTimePreKeyId !== undefined
        ? { keyId: claimed.oneTimePreKeyId, publicKey: unb64(claimed.oneTimePreKey) }
        : undefined,
  };
  await new SessionBuilder(store, address).processPreKey(bundle as never);
}

export interface SignalMessage {
  type: number; // 3 = PreKey message, 1 = normal
  body: string; // libsignal binary string
}

export async function encryptSignal(store: SignalStore, address: SignalProtocolAddress, plaintext: Uint8Array): Promise<SignalMessage> {
  const cipher = new SessionCipher(store, address);
  const m = await cipher.encrypt(toAB(plaintext));
  return { type: m.type, body: m.body as string };
}

export async function decryptSignal(store: SignalStore, address: SignalProtocolAddress, msg: SignalMessage): Promise<Uint8Array> {
  const cipher = new SessionCipher(store, address);
  const pt =
    msg.type === 3
      ? await cipher.decryptPreKeyWhisperMessage(msg.body, "binary")
      : await cipher.decryptWhisperMessage(msg.body, "binary");
  return new Uint8Array(pt);
}

export function hasSession(store: SignalStore, address: SignalProtocolAddress): Promise<boolean> {
  return store.loadSession(address.toString()).then((r) => r !== undefined);
}

/** Signal safety number (60 digits) between two identities. */
export async function signalSafetyNumber(
  localId: string,
  localIdentityKey: string,
  remoteId: string,
  remoteIdentityKey: string,
): Promise<string> {
  const gen = new FingerprintGenerator(1024);
  return gen.createFor(localId, unb64(localIdentityKey), remoteId, unb64(remoteIdentityKey));
}
