/**
 * MessagingService — encrypt on send, decrypt on receive, over the transport,
 * with multi-device fan-out.
 *
 * A message is encrypted separately for every one of the recipient's devices AND
 * synced to the sender's own other devices, so a conversation stays consistent
 * across all a user's devices. Each (user, device) pair has its own Double
 * Ratchet session. The decrypted payload carries {from, to} so a receiver can
 * place it in the right conversation and tell its own sent copies apart.
 *
 * Plaintext exists only in memory here and above; the relay only sees ciphertext.
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

/** Directory operations the messaging layer needs. */
export interface BundleSource {
  /** Claim a prekey bundle for a specific device (consumes a one-time prekey). */
  claimBundle(userId: string, deviceId?: string): Promise<ResolvedPreKeyBundle | undefined>;
  /** List a user's device ids (for fan-out). */
  deviceList(userId: string): Promise<{ userId: string; deviceIds: string[] } | undefined>;
}

/** The decrypted message payload the ratchet protects. */
interface Payload {
  v: 1;
  from: string; // sender account id
  to: string; // recipient account id (the conversation's other party)
  body: string;
}

function encodePayload(p: Payload): Uint8Array {
  return utf8(JSON.stringify(p));
}
function decodePayload(b: Uint8Array): Payload {
  return JSON.parse(fromUtf8(b)) as Payload;
}

export interface SessionRecord {
  peerUserId: string;
  peerDevice: string;
  session: DirectSession;
}

/** Persists live sessions, one per (peer user, peer device). */
export interface SessionStore {
  load(peerUserId: string, peerDevice: string): Promise<SessionRecord | undefined>;
  save(rec: SessionRecord): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private map = new Map<string, SessionRecord>();
  private key(u: string, d: string) {
    return `${u}/${d}`;
  }
  async load(peerUserId: string, peerDevice: string) {
    return this.map.get(this.key(peerUserId, peerDevice));
  }
  async save(rec: SessionRecord) {
    this.map.set(this.key(rec.peerUserId, rec.peerDevice), rec);
  }
}

export interface InboundMessage {
  /** The other party in the conversation this message belongs to. */
  from: string;
  fromDevice: string;
  text: string;
  /** True when this is one of our own messages, synced from another of our devices. */
  outgoing: boolean;
}

interface Target {
  userId: string;
  deviceId: string;
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

  /** Encrypt and fan a text message out to every recipient device and our own other devices. */
  async sendText(peerUserId: string, text: string): Promise<void> {
    const plaintext = encodePayload({ v: 1, from: this.selfUserId, to: peerUserId, body: text });
    const targets = await this.fanoutTargets(peerUserId);
    for (const target of targets) {
      let rec: SessionRecord;
      try {
        rec = await this.ensureSession(target.userId, target.deviceId);
      } catch {
        continue; // a device with no claimable bundle is skipped, not fatal
      }
      const msg = await encryptMessage(rec.session, plaintext);
      await this.sessions.save(rec);
      await this.transport.send({
        senderUser: this.selfUserId,
        senderDevice: this.self.deviceId,
        recipientUser: target.userId,
        recipientDevice: target.deviceId,
        ciphertext: serializeMessage(msg),
      });
    }
  }

  /** Every recipient device, plus our own other devices (for sync). */
  private async fanoutTargets(peerUserId: string): Promise<Target[]> {
    const out: Target[] = [];
    const peer = await this.directory.deviceList(peerUserId);
    for (const d of peer?.deviceIds ?? []) out.push({ userId: peerUserId, deviceId: d });

    if (peerUserId !== this.selfUserId) {
      const mine = await this.directory.deviceList(this.selfUserId);
      for (const d of mine?.deviceIds ?? []) {
        if (d !== this.self.deviceId) out.push({ userId: this.selfUserId, deviceId: d });
      }
    }
    if (out.length === 0) throw new Error(`no devices registered for ${peerUserId}`);
    return out;
  }

  private async ensureSession(userId: string, deviceId: string): Promise<SessionRecord> {
    const existing = await this.sessions.load(userId, deviceId);
    if (existing) return existing;

    const bundle = await this.directory.claimBundle(userId, deviceId);
    if (!bundle) throw new Error(`no prekey bundle for ${userId}/${deviceId}`);
    return { peerUserId: userId, peerDevice: bundle.deviceId, session: startInitiatorSession(this.self, bundle) };
  }

  private async handle(env: QueuedEnvelope): Promise<void> {
    const msg = deserializeMessage(env.ciphertext);
    const senderUser = env.senderUser;
    const senderDevice = env.senderDevice;

    let rec = await this.sessions.load(senderUser, senderDevice);
    if (!rec) {
      if (!msg.preamble) throw new Error("no session and message carries no X3DH preamble");
      rec = { peerUserId: senderUser, peerDevice: senderDevice, session: startResponderSession(this.self, msg.preamble) };
    }

    const plaintext = await decryptMessage(rec.session, msg);
    await this.sessions.save(rec);
    await this.transport.ack([env.id]);

    const payload = decodePayload(plaintext);
    const outgoing = payload.from === this.selfUserId; // a sync copy of our own message
    const conversationPeer = outgoing ? payload.to : payload.from;
    this.onMessage?.({ from: conversationPeer, fromDevice: senderDevice, text: payload.body, outgoing });
  }
}
