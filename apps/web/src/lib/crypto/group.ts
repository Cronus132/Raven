/**
 * GroupService — group state + Sender Keys messaging (transport-agnostic).
 *
 * Each member holds its own sending chain for a group and a receiving chain per
 * other member (learned from their distribution message, delivered 1:1 over the
 * pairwise Double Ratchet). encrypt/decrypt are pure crypto over opaque bytes;
 * the transport wiring (distribution + group ciphertext fan-out) lives above.
 */

import { advanceChain, newSenderChain, openGroup, sealGroup, type SenderChain } from "./senderKey";
import { fromBase64, toBase64, utf8 } from "./primitives";

const MAX_SKIP = 2000;

/** A member's sender key for a group, shared 1:1 so others can decrypt its messages. */
export interface SenderKeyDistribution {
  groupId: string;
  name: string;
  members: string[];
  chainKey: string; // base64
  iteration: number;
}

/** An encrypted group message (the body is sealed under the sender's message key). */
export interface GroupCiphertext {
  groupId: string;
  sender: string;
  iteration: number;
  body: Uint8Array;
}

interface RecvChain {
  chainKey: Uint8Array;
  iteration: number;
  skipped: Map<number, Uint8Array>;
}

interface GroupRecord {
  groupId: string;
  name: string;
  members: Set<string>;
  sending: SenderChain;
  receiving: Map<string, RecvChain>; // senderUserId -> chain
}

export class GroupService {
  private groups = new Map<string, GroupRecord>();

  constructor(private readonly selfUserId: string) {}

  private must(groupId: string): GroupRecord {
    const g = this.groups.get(groupId);
    if (!g) throw new Error(`unknown group ${groupId}`);
    return g;
  }

  has(groupId: string): boolean {
    return this.groups.has(groupId);
  }

  /** Create or update a group, generating our own sending key if new. */
  ensureGroup(groupId: string, name: string, members: string[]): void {
    const existing = this.groups.get(groupId);
    if (!existing) {
      this.groups.set(groupId, {
        groupId,
        name,
        members: new Set(members),
        sending: newSenderChain(),
        receiving: new Map(),
      });
      return;
    }
    if (name) existing.name = name;
    for (const m of members) existing.members.add(m);
  }

  members(groupId: string): string[] {
    return [...this.must(groupId).members];
  }

  name(groupId: string): string {
    return this.must(groupId).name;
  }

  /** Our current sender key for the group, to send 1:1 to each member. */
  distribution(groupId: string): SenderKeyDistribution {
    const g = this.must(groupId);
    return {
      groupId,
      name: g.name,
      members: [...g.members],
      chainKey: toBase64(g.sending.chainKey),
      iteration: g.sending.iteration,
    };
  }

  /** Learn another member's sender key (creates the group locally if needed). */
  applyDistribution(dist: SenderKeyDistribution, fromUserId: string): void {
    this.ensureGroup(dist.groupId, dist.name, dist.members);
    this.must(dist.groupId).receiving.set(fromUserId, {
      chainKey: fromBase64(dist.chainKey),
      iteration: dist.iteration,
      skipped: new Map(),
    });
  }

  async encrypt(groupId: string, plaintext: Uint8Array): Promise<GroupCiphertext> {
    const g = this.must(groupId);
    const { chain, messageKey, iteration } = advanceChain(g.sending);
    g.sending = chain;
    const aad = utf8(`${groupId}:${this.selfUserId}:${iteration}`);
    return { groupId, sender: this.selfUserId, iteration, body: await sealGroup(messageKey, plaintext, aad) };
  }

  async decrypt(groupId: string, fromUserId: string, iteration: number, body: Uint8Array): Promise<Uint8Array> {
    const g = this.must(groupId);
    const recv = g.receiving.get(fromUserId);
    if (!recv) throw new Error(`no sender key from ${fromUserId} in ${groupId}`);
    const aad = utf8(`${groupId}:${fromUserId}:${iteration}`);

    const stashed = recv.skipped.get(iteration);
    if (stashed) {
      recv.skipped.delete(iteration);
      return openGroup(stashed, body, aad);
    }
    if (iteration < recv.iteration) throw new Error("stale group message");
    if (recv.iteration + MAX_SKIP < iteration) throw new Error("too many skipped group messages");

    let cur: SenderChain = { chainKey: recv.chainKey, iteration: recv.iteration };
    let messageKey: Uint8Array | null = null;
    while (cur.iteration <= iteration) {
      const stepped = advanceChain(cur);
      if (stepped.iteration === iteration) {
        messageKey = stepped.messageKey;
        cur = stepped.chain;
        break;
      }
      recv.skipped.set(stepped.iteration, stepped.messageKey);
      cur = stepped.chain;
    }
    recv.chainKey = cur.chainKey;
    recv.iteration = cur.iteration;
    if (!messageKey) throw new Error("group message key unavailable");
    return openGroup(messageKey, body, aad);
  }
}
