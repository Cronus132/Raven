/**
 * MessagingService — encrypt on send, decrypt on receive, over the transport.
 *
 * This is what the chat UI drives. It realizes the 1:1 part of the CryptoEngine
 * contract (encryptDirect/decryptDirect) by holding Double Ratchet sessions,
 * establishing them from fetched prekey bundles, persisting them, and moving
 * opaque envelopes through a Transport. Plaintext exists only in memory here and
 * above; the relay only ever sees ciphertext.
 *
 * Scope (first transport cut): one device per user (no multi-device fan-out yet)
 * and in-memory session storage by default. Multi-device and sealed-at-rest
 * session persistence in the keystore come next.
 */

import type { DeviceSecret } from "./identity";
import type { ResolvedPreKeyBundle } from "./x3dh";
import {
  decryptMessage,
  deserializeMessage,
  encryptMessage,
  serializeMessage,
  startInitiatorSession,
  startResponderSession,
  type DirectSession,
} from "./session";
import type { QueuedEnvelope, Transport } from "@/lib/transport/transport";

const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

/** Source of prekey bundles for starting new sessions (consumes a one-time prekey). */
export interface BundleSource {
  claimBundle(userId: string, deviceId?: string): Promise<ResolvedPreKeyBundle | undefined>;
}

export interface SessionRecord {
  peerUserId: string;
  peerDevice: string;
  session: DirectSession;
}

/** Persists live sessions. In-memory by default; a sealed keystore impl comes later. */
export interface SessionStore {
  load(peerUserId: string): Promise<SessionRecord | undefined>;
  save(rec: SessionRecord): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private map = new Map<string, SessionRecord>();
  async load(peerUserId: string) {
    return this.map.get(peerUserId);
  }
  async save(rec: SessionRecord) {
    this.map.set(rec.peerUserId, rec);
  }
}

export interface InboundMessage {
  from: string; // sender user id
  fromDevice: string;
  text: string;
}

export class MessagingService {
  onMessage?: (msg: InboundMessage) => void;
  private unsubscribe?: () => void;

  constructor(
    private readonly self: DeviceSecret,
    private readonly selfUserId: string,
    private readonly directory: BundleSource,
    private readonly transport: Transport,
    private readonly sessions: SessionStore = new InMemorySessionStore(),
  ) {}

  /** Drain the offline queue, then subscribe for realtime delivery. */
  async start(): Promise<void> {
    const queued = await this.transport.fetchQueued();
    for (const env of queued) await this.handle(env);
    this.unsubscribe = this.transport.subscribe((env) => void this.handle(env));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Encrypt and send a text message to a peer (establishing a session if needed). */
  async sendText(peerUserId: string, text: string): Promise<void> {
    const rec = await this.ensureSendSession(peerUserId);
    const msg = await encryptMessage(rec.session, utf8(text));
    await this.sessions.save(rec);
    await this.transport.send({
      senderUser: this.selfUserId,
      senderDevice: this.self.deviceId,
      recipientUser: peerUserId,
      recipientDevice: rec.peerDevice,
      ciphertext: serializeMessage(msg),
    });
  }

  private async ensureSendSession(peerUserId: string): Promise<SessionRecord> {
    const existing = await this.sessions.load(peerUserId);
    if (existing) return existing;

    const bundle = await this.directory.claimBundle(peerUserId);
    if (!bundle) throw new Error(`no prekey bundle available for ${peerUserId}`);
    const session = startInitiatorSession(this.self, bundle);
    return { peerUserId, peerDevice: bundle.deviceId, session };
  }

  private async handle(env: QueuedEnvelope): Promise<void> {
    const msg = deserializeMessage(env.ciphertext);
    const peerUserId = env.senderUser;

    let rec = await this.sessions.load(peerUserId);
    if (!rec) {
      if (!msg.preamble) throw new Error("no session and message carries no X3DH preamble");
      rec = { peerUserId, peerDevice: env.senderDevice, session: startResponderSession(this.self, msg.preamble) };
    }

    const plaintext = await decryptMessage(rec.session, msg);
    await this.sessions.save(rec);
    await this.transport.ack([env.id]);
    this.onMessage?.({ from: peerUserId, fromDevice: env.senderDevice, text: fromUtf8(plaintext) });
  }
}
