/**
 * CryptoEngine — the single boundary between Raven's UI/transport and the
 * end-to-end cryptography. Everything above this interface deals only in
 * plaintext (in memory) and opaque ciphertext envelopes. Nothing above it
 * ever touches key material.
 *
 * The production implementation of this interface is a shared Rust core
 * (libsignal for X3DH + Double Ratchet, OpenMLS for groups) compiled to
 * WebAssembly for the browser and to native for desktop/Android via Tauri.
 * See `docs/ARCHITECTURE.md`. This file defines the contract so the UI can be
 * built and tested against a mock, then swapped to the real core with no
 * churn above this line.
 *
 * Design rules encoded here:
 *  - Private keys and ratchet state never cross this boundary.
 *  - 1:1 sessions use X3DH setup + Double Ratchet (forward secrecy + PCS).
 *  - Groups use MLS (RFC 9420): commit/welcome drive membership, messages are
 *    protected by the group's ratchet.
 *  - Identity is per-device; a message to a user fans out per recipient device.
 */

export type DeviceId = string;
export type UserId = string;

/** Public identity material published to the key directory. Public only. */
export interface PreKeyBundle {
  userId: UserId;
  deviceId: DeviceId;
  identityKey: Uint8Array; // long-term public identity key (Ed25519/X25519)
  signedPreKey: Uint8Array; // rotated periodically, signed by identity key
  signedPreKeySignature: Uint8Array;
  oneTimePreKey?: Uint8Array; // consumed on use; absent if directory ran out
  registrationId: number;
}

/** An opaque, encrypted message ready to hand to the relay. */
export interface Envelope {
  toUser: UserId;
  toDevice: DeviceId;
  /** Sealed-sender: the server learns the recipient, not the authenticated sender. */
  ciphertext: Uint8Array;
  /** Fixed-size padding bucket this envelope was padded to. */
  paddedLength: number;
}

export interface DecryptResult {
  fromUser: UserId;
  fromDevice: DeviceId;
  plaintext: Uint8Array;
}

/** Hash of both identity keys, rendered as a comparable safety number. */
export interface SafetyNumber {
  conversationId: string;
  numeric: string; // 60-digit grouped number
  qrPayload: Uint8Array;
}

export interface IdentityChange {
  userId: UserId;
  deviceId: DeviceId;
  previousKey: Uint8Array;
  currentKey: Uint8Array;
  at: number;
}

export interface CryptoEngine {
  /** Create or load this device's identity + prekeys. Returns the public bundle to publish. */
  initDevice(passphrase: string): Promise<PreKeyBundle>;

  /** Establish a 1:1 session from a fetched prekey bundle (X3DH). */
  beginSession(bundle: PreKeyBundle): Promise<void>;

  /** Encrypt a plaintext body for every device of a user (fan-out). */
  encryptDirect(toUser: UserId, plaintext: Uint8Array): Promise<Envelope[]>;

  /** Decrypt an inbound 1:1 envelope, advancing the Double Ratchet. */
  decryptDirect(envelope: Envelope): Promise<DecryptResult>;

  // ---- Groups (MLS) ----
  createGroup(groupId: string, members: PreKeyBundle[]): Promise<Uint8Array /* welcome */>;
  encryptGroup(groupId: string, plaintext: Uint8Array): Promise<Envelope[]>;
  decryptGroup(groupId: string, envelope: Envelope): Promise<DecryptResult>;
  addMembers(groupId: string, members: PreKeyBundle[]): Promise<Uint8Array /* commit */>;
  removeMembers(groupId: string, members: UserId[]): Promise<Uint8Array /* commit */>;

  // ---- Trust ----
  safetyNumber(conversationId: string): Promise<SafetyNumber>;
  onIdentityChange(handler: (change: IdentityChange) => void): () => void;
}
