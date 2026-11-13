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
import { GroupService, type GroupCiphertext, type SenderKeyDistribution } from "./group";
import { fromBase64, toBase64 } from "./primitives";
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

/** A reference to an encrypted attachment: where to fetch it and how to decrypt it. */
export interface MediaRef {
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
  path: string; // storage path of the ciphertext blob
  key: string; // base64 AES key (travels only inside the E2E message)
  iv: string; // base64
}

/** The decrypted payloads the ratchet protects. */
type TextPayload = { v: 1; t: "text"; from: string; to: string; id: string; body: string };
type ReceiptPayload = { v: 1; t: "receipt"; from: string; to: string; kind: "delivered" | "read"; ids: string[] };
type MediaPayload = { v: 1; t: "media"; from: string; to: string; id: string; caption?: string; media: MediaRef };
type SkdmPayload = { v: 1; t: "skdm"; from: string; to: string; dist: SenderKeyDistribution };
type Payload = TextPayload | ReceiptPayload | MediaPayload | SkdmPayload;

function encodePayload(p: Payload): Uint8Array {
  return utf8(JSON.stringify(p));
}
function decodePayload(b: Uint8Array): Payload {
  return JSON.parse(fromUtf8(b)) as Payload;
}

// Group ciphertext travels as its own tagged wire blob (not a pairwise ratchet message).
interface GroupWire {
  k: "group";
  groupId: string;
  sender: string;
  iteration: number;
  body: string; // base64
}
function serializeGroupCiphertext(gc: GroupCiphertext): string {
  const wire: GroupWire = { k: "group", groupId: gc.groupId, sender: gc.sender, iteration: gc.iteration, body: toBase64(gc.body) };
  return toBase64(utf8(JSON.stringify(wire)));
}
function tryParseGroupWire(blob: string): GroupWire | null {
  try {
    const o = JSON.parse(fromUtf8(fromBase64(blob)));
    return o && o.k === "group" ? (o as GroupWire) : null;
  } catch {
    return null;
  }
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
  /** The sender's message id (for read receipts). */
  id: string;
  /** True when this is one of our own messages, synced from another of our devices. */
  outgoing: boolean;
  /** Present when the message carries an encrypted attachment. */
  media?: MediaRef;
}

export interface Receipt {
  ids: string[];
  kind: "delivered" | "read";
}

export interface InboundGroupMessage {
  groupId: string;
  name: string;
  members: string[];
  from: string;
  text: string;
  id: string;
  outgoing: boolean;
}

interface Target {
  userId: string;
  deviceId: string;
}

export class MessagingService {
  onMessage?: (msg: InboundMessage) => void;
  onReceipt?: (receipt: Receipt) => void;
  onGroupMessage?: (msg: InboundGroupMessage) => void;
  private unsubscribe?: () => void;

  private readonly group: GroupService;
  private readonly distributedTo = new Map<string, Set<string>>(); // groupId -> users we've sent our key to
  private readonly pendingGroup = new Map<string, GroupCiphertext[]>(); // `${groupId}/${sender}` -> queued

  constructor(
    private readonly self: DeviceSecret,
    private readonly selfUserId: string,
    private readonly directory: BundleSource,
    private readonly transport: Transport,
    private readonly sessions: SessionStore = new InMemorySessionStore(),
  ) {
    this.group = new GroupService(selfUserId);
  }

  /** Drain the offline queue, then subscribe for realtime delivery. */
  async start(): Promise<void> {
    const queued = await this.transport.fetchQueued();
    for (const env of queued) {
      try {
        await this.handle(env);
      } catch {
        /* a single bad envelope must not stop the drain */
      }
    }
    this.unsubscribe = this.transport.subscribe((env) => void this.handle(env).catch(() => {}));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Encrypt and fan a text message out to every recipient device and our own other devices. */
  async sendText(peerUserId: string, text: string, messageId: string = crypto.randomUUID()): Promise<void> {
    const plaintext = encodePayload({ v: 1, t: "text", from: this.selfUserId, to: peerUserId, id: messageId, body: text });
    await this.deliver(await this.fanoutTargets(peerUserId), plaintext);
  }

  /** Encrypt and fan an attachment message out (the blob itself is already uploaded). */
  async sendMedia(peerUserId: string, media: MediaRef, messageId: string, caption?: string): Promise<void> {
    const plaintext = encodePayload({ v: 1, t: "media", from: this.selfUserId, to: peerUserId, id: messageId, caption, media });
    await this.deliver(await this.fanoutTargets(peerUserId), plaintext);
  }

  /** Send a delivery/read receipt to the peer's devices. */
  async sendReceipt(toUserId: string, kind: "delivered" | "read", ids: string[]): Promise<void> {
    if (!ids.length) return;
    const plaintext = encodePayload({ v: 1, t: "receipt", from: this.selfUserId, to: toUserId, kind, ids });
    await this.deliver(await this.peerDevices(toUserId), plaintext);
  }

  private async deliver(targets: Target[], plaintext: Uint8Array): Promise<void> {
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

  /** Just the devices of one user (excluding our own device), for receipts. */
  private async peerDevices(userId: string): Promise<Target[]> {
    const list = await this.directory.deviceList(userId);
    return (list?.deviceIds ?? [])
      .filter((d) => !(userId === this.selfUserId && d === this.self.deviceId))
      .map((deviceId) => ({ userId, deviceId }));
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

  // ---- groups (Sender Keys) -------------------------------------------------

  /** Create a group and distribute our sender key to the members. */
  async createGroup(groupId: string, name: string, memberUserIds: string[]): Promise<void> {
    const members = Array.from(new Set([...memberUserIds, this.selfUserId]));
    this.group.ensureGroup(groupId, name, members);
    await this.distributeKey(groupId, members);
  }

  groupMembers(groupId: string): string[] {
    return this.group.has(groupId) ? this.group.members(groupId) : [];
  }

  /** Encrypt a group message once and fan the ciphertext out to all member devices. */
  async sendGroupText(groupId: string, text: string, messageId: string): Promise<void> {
    await this.distributeKey(groupId, this.group.members(groupId));
    const plaintext = utf8(JSON.stringify({ id: messageId, body: text }));
    const gc = await this.group.encrypt(groupId, plaintext);
    const wire = serializeGroupCiphertext(gc);
    for (const target of await this.groupTargets(groupId)) {
      await this.transport.send({
        senderUser: this.selfUserId,
        senderDevice: this.self.deviceId,
        recipientUser: target.userId,
        recipientDevice: target.deviceId,
        ciphertext: wire,
      });
    }
  }

  /** Send our sender key (1:1, over the pairwise ratchet) to members who lack it. */
  private async distributeKey(groupId: string, toUserIds: string[]): Promise<void> {
    const dist = this.group.distribution(groupId);
    const sent = this.distributedTo.get(groupId) ?? new Set<string>();
    for (const user of toUserIds) {
      if (sent.has(user)) continue;
      const plaintext = encodePayload({ v: 1, t: "skdm", from: this.selfUserId, to: user, dist });
      await this.deliver(await this.peerDevices(user), plaintext);
      sent.add(user);
    }
    this.distributedTo.set(groupId, sent);
  }

  private async groupTargets(groupId: string): Promise<Target[]> {
    const out: Target[] = [];
    for (const member of this.group.members(groupId)) {
      const list = await this.directory.deviceList(member);
      for (const d of list?.deviceIds ?? []) {
        if (member === this.selfUserId && d === this.self.deviceId) continue;
        out.push({ userId: member, deviceId: d });
      }
    }
    return out;
  }

  private async handleGroup(gw: GroupWire): Promise<void> {
    const gc: GroupCiphertext = { groupId: gw.groupId, sender: gw.sender, iteration: gw.iteration, body: fromBase64(gw.body) };
    if (!this.group.hasSender(gc.groupId, gc.sender)) {
      // sender key not yet known (its skdm hasn't arrived) — queue and retry on arrival
      const key = `${gc.groupId}/${gc.sender}`;
      const q = this.pendingGroup.get(key) ?? [];
      q.push(gc);
      this.pendingGroup.set(key, q);
      return;
    }
    await this.deliverGroup(gc);
  }

  private async deliverGroup(gc: GroupCiphertext): Promise<void> {
    try {
      const pt = await this.group.decrypt(gc.groupId, gc.sender, gc.iteration, gc.body);
      const { id, body } = JSON.parse(fromUtf8(pt)) as { id: string; body: string };
      this.onGroupMessage?.({
        groupId: gc.groupId,
        name: this.group.name(gc.groupId),
        members: this.group.members(gc.groupId),
        from: gc.sender,
        text: body,
        id,
        outgoing: gc.sender === this.selfUserId,
      });
    } catch {
      /* undecryptable (missing/duplicate) — dropped */
    }
  }

  private flushPending(groupId: string, sender: string): void {
    const key = `${groupId}/${sender}`;
    const q = this.pendingGroup.get(key);
    if (!q) return;
    this.pendingGroup.delete(key);
    for (const gc of q) void this.deliverGroup(gc);
  }

  private async handle(env: QueuedEnvelope): Promise<void> {
    const groupWire = tryParseGroupWire(env.ciphertext);
    if (groupWire) {
      await this.transport.ack([env.id]);
      await this.handleGroup(groupWire);
      return;
    }

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
    if (payload.t === "receipt") {
      this.onReceipt?.({ ids: payload.ids, kind: payload.kind });
      return;
    }
    if (payload.t === "skdm") {
      this.group.applyDistribution(payload.dist, payload.from);
      this.flushPending(payload.dist.groupId, payload.from);
      // reciprocate so the sender (and any new members) can read our messages
      void this.distributeKey(payload.dist.groupId, payload.dist.members).catch(() => {});
      return;
    }

    const outgoing = payload.from === this.selfUserId; // a sync copy of our own message
    const conversationPeer = outgoing ? payload.to : payload.from;
    if (payload.t === "media") {
      this.onMessage?.({
        from: conversationPeer,
        fromDevice: senderDevice,
        text: payload.caption ?? "",
        id: payload.id,
        outgoing,
        media: payload.media,
      });
    } else {
      this.onMessage?.({ from: conversationPeer, fromDevice: senderDevice, text: payload.body, outgoing, id: payload.id });
    }
    // Acknowledge delivery back to the sender (not for our own synced copies).
    if (!outgoing) void this.sendReceipt(payload.from, "delivered", [payload.id]).catch(() => {});
  }
}
