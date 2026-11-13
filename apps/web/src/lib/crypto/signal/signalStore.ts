/**
 * Keystore-persistable SignalProtocolStore for the libsignal-protocol engine.
 *
 * Holds this device's libsignal identity key pair, registration id, pre-keys,
 * signed pre-keys, known remote identities, and sessions. Everything is kept in
 * memory and serialized to JSON (base64) so the encrypted keystore can seal it
 * at rest. libsignal owns the ratchet state inside the opaque session records.
 */

import type { KeyPairType, StorageType } from "@privacyresearch/libsignal-protocol-typescript";
import { Direction } from "@privacyresearch/libsignal-protocol-typescript";
import { fromBase64, toBase64 } from "../primitives";

const b64 = (ab: ArrayBuffer) => toBase64(new Uint8Array(ab));
const unb64 = (s: string) => fromBase64(s).buffer as ArrayBuffer;
const kpOut = (kp: KeyPairType) => ({ pubKey: b64(kp.pubKey), privKey: b64(kp.privKey) });
const kpIn = (o: { pubKey: string; privKey: string }): KeyPairType => ({ pubKey: unb64(o.pubKey), privKey: unb64(o.privKey) });

interface StoreData {
  identityKeyPair?: { pubKey: string; privKey: string };
  registrationId?: number;
  preKeys: Record<string, { pubKey: string; privKey: string }>;
  signedPreKeys: Record<string, { pubKey: string; privKey: string }>;
  sessions: Record<string, string>; // address -> session record (libsignal binary string)
  identities: Record<string, string>; // address -> identity pubKey (base64)
}

export class SignalStore implements StorageType {
  private identityKeyPair?: KeyPairType;
  private registrationId?: number;
  private preKeys = new Map<string, KeyPairType>();
  private signedPreKeys = new Map<string, KeyPairType>();
  private sessions = new Map<string, string>();
  private identities = new Map<string, ArrayBuffer>();

  setIdentity(keyPair: KeyPairType, registrationId: number): void {
    this.identityKeyPair = keyPair;
    this.registrationId = registrationId;
  }

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    return this.identityKeyPair;
  }
  async getLocalRegistrationId(): Promise<number | undefined> {
    return this.registrationId;
  }

  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    const known = this.identities.get(identifier);
    if (!known) return true; // trust on first use
    return b64(known) === b64(identityKey);
  }
  async saveIdentity(identifier: string, publicKey: ArrayBuffer): Promise<boolean> {
    const known = this.identities.get(identifier);
    this.identities.set(identifier, publicKey);
    return known !== undefined && b64(known) !== b64(publicKey); // true if the identity changed
  }
  async loadIdentityKey(identifier: string): Promise<ArrayBuffer | undefined> {
    return this.identities.get(identifier);
  }

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return this.preKeys.get(String(keyId));
  }
  async storePreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    this.preKeys.set(String(keyId), keyPair);
  }
  async removePreKey(keyId: string | number): Promise<void> {
    this.preKeys.delete(String(keyId));
  }

  async loadSignedPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return this.signedPreKeys.get(String(keyId));
  }
  async storeSignedPreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    this.signedPreKeys.set(String(keyId), keyPair);
  }
  async removeSignedPreKey(keyId: string | number): Promise<void> {
    this.signedPreKeys.delete(String(keyId));
  }

  async loadSession(identifier: string): Promise<string | undefined> {
    return this.sessions.get(identifier);
  }
  async storeSession(identifier: string, record: string): Promise<void> {
    this.sessions.set(identifier, record);
  }

  // expose Direction so callers can satisfy the interface's enum usage
  readonly Direction = Direction;

  // ---- persistence ----------------------------------------------------------

  serialize(): string {
    const data: StoreData = {
      identityKeyPair: this.identityKeyPair ? kpOut(this.identityKeyPair) : undefined,
      registrationId: this.registrationId,
      preKeys: Object.fromEntries([...this.preKeys].map(([k, v]) => [k, kpOut(v)])),
      signedPreKeys: Object.fromEntries([...this.signedPreKeys].map(([k, v]) => [k, kpOut(v)])),
      sessions: Object.fromEntries(this.sessions),
      identities: Object.fromEntries([...this.identities].map(([k, v]) => [k, b64(v)])),
    };
    return JSON.stringify(data);
  }

  static deserialize(json: string): SignalStore {
    const data = JSON.parse(json) as StoreData;
    const store = new SignalStore();
    if (data.identityKeyPair) store.identityKeyPair = kpIn(data.identityKeyPair);
    store.registrationId = data.registrationId;
    for (const [k, v] of Object.entries(data.preKeys ?? {})) store.preKeys.set(k, kpIn(v));
    for (const [k, v] of Object.entries(data.signedPreKeys ?? {})) store.signedPreKeys.set(k, kpIn(v));
    for (const [k, v] of Object.entries(data.sessions ?? {})) store.sessions.set(k, v);
    for (const [k, v] of Object.entries(data.identities ?? {})) store.identities.set(k, unb64(v));
    return store;
  }
}
