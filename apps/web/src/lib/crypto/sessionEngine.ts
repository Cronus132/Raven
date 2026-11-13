/**
 * SessionEngine — the pairwise 1:1 crypto the MessagingService runs on.
 *
 * It owns session establishment + the Double Ratchet, exposing bytes-in /
 * wire-out (and back). The default implementation is libsignal-protocol
 * (SignalSessionEngine); the earlier spec-faithful @noble ratchet remains in
 * session.ts as reference. Keeping this behind an interface is what let us swap
 * the ratchet without touching the fan-out / receipts / groups layers above.
 */

import type { ResolvedPreKeyBundle } from "./x3dh";
import { toBase64 } from "./primitives";
import { SignalStore } from "./signal/signalStore";
import {
  addressOf,
  decryptSignal,
  deserializeSignalMessage,
  encryptSignal,
  establishSession,
  hasSession as signalHasSession,
  serializeSignalMessage,
  type ClaimedSignalBundle,
} from "./signal/signalDevice";

export interface SessionEngine {
  readonly selfDeviceId: string;
  /** Our identity public key (base64), for publishing + safety numbers. */
  identityKey(): string;
  hasSession(userId: string, deviceId: string): Promise<boolean>;
  establish(userId: string, deviceId: string, bundle: ResolvedPreKeyBundle): Promise<void>;
  encrypt(userId: string, deviceId: string, plaintext: Uint8Array): Promise<string>;
  decrypt(senderUserId: string, senderDeviceId: string, wire: string): Promise<Uint8Array>;
}

function toClaimed(b: ResolvedPreKeyBundle): ClaimedSignalBundle {
  return {
    registrationId: b.registrationId,
    identityKey: toBase64(b.identityKey),
    signedPreKeyId: b.signedPreKeyId,
    signedPreKey: toBase64(b.signedPreKey),
    signedPreKeySignature: toBase64(b.signedPreKeySignature),
    oneTimePreKeyId: b.oneTimePreKeyId,
    oneTimePreKey: b.oneTimePreKey ? toBase64(b.oneTimePreKey) : undefined,
  };
}

export class SignalSessionEngine implements SessionEngine {
  constructor(
    private readonly store: SignalStore,
    readonly selfDeviceId: string,
    private readonly identityKeyB64: string,
    private readonly onChange?: () => void,
  ) {}

  identityKey(): string {
    return this.identityKeyB64;
  }

  hasSession(userId: string, deviceId: string): Promise<boolean> {
    return signalHasSession(this.store, addressOf(userId, deviceId));
  }

  async establish(userId: string, deviceId: string, bundle: ResolvedPreKeyBundle): Promise<void> {
    await establishSession(this.store, addressOf(userId, deviceId), toClaimed(bundle));
    this.onChange?.();
  }

  async encrypt(userId: string, deviceId: string, plaintext: Uint8Array): Promise<string> {
    const msg = await encryptSignal(this.store, addressOf(userId, deviceId), plaintext);
    this.onChange?.();
    return serializeSignalMessage(msg);
  }

  async decrypt(senderUserId: string, senderDeviceId: string, wire: string): Promise<Uint8Array> {
    const pt = await decryptSignal(this.store, addressOf(senderUserId, senderDeviceId), deserializeSignalMessage(wire));
    this.onChange?.();
    return pt;
  }
}
