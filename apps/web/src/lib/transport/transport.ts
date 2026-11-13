/**
 * Ciphertext transport — the boundary between the crypto layer and the relay.
 *
 * The relay moves opaque envelopes between devices and queues them for offline
 * recipients. It never sees plaintext or keys; `ciphertext` is the serialized
 * Double Ratchet message. This file defines the interface plus an in-memory bus
 * used in tests; the Supabase implementation lives in supabaseTransport.ts.
 */

export interface WireEnvelope {
  senderUser: string;
  senderDevice: string;
  recipientUser: string;
  recipientDevice: string;
  ciphertext: string; // opaque, base64 (serializeMessage output)
}

export interface QueuedEnvelope extends WireEnvelope {
  id: string; // relay-assigned; used to drain the queue
}

export interface Transport {
  /** Hand an envelope to the relay for delivery. */
  send(env: WireEnvelope): Promise<void>;
  /** Fetch this device's queued (not-yet-drained) envelopes, oldest first. */
  fetchQueued(): Promise<QueuedEnvelope[]>;
  /** Subscribe to envelopes delivered in realtime; returns an unsubscribe fn. */
  subscribe(onEnvelope: (env: QueuedEnvelope) => void): () => void;
  /** Drain (delete) envelopes once decrypted. */
  ack(ids: string[]): Promise<void>;
}

// ---- in-memory bus (tests / offline demo) -----------------------------------

type Sub = (env: QueuedEnvelope) => void;

/** A fake relay shared by multiple in-memory Transport views. */
export class InMemoryMessageBus {
  private rows: QueuedEnvelope[] = [];
  private seq = 0;
  private subs = new Map<string, Set<Sub>>(); // key: `${user}/${device}`

  private key(user: string, device: string) {
    return `${user}/${device}`;
  }

  /** A Transport bound to one device. */
  forDevice(user: string, device: string): Transport {
    const k = this.key(user, device);
    return {
      send: async (env) => {
        const queued: QueuedEnvelope = { ...env, id: String(++this.seq) };
        this.rows.push(queued);
        const rk = this.key(env.recipientUser, env.recipientDevice);
        for (const cb of this.subs.get(rk) ?? []) cb(queued);
      },
      fetchQueued: async () =>
        this.rows.filter((r) => r.recipientUser === user && r.recipientDevice === device),
      subscribe: (cb) => {
        const set = this.subs.get(k) ?? new Set<Sub>();
        set.add(cb);
        this.subs.set(k, set);
        return () => set.delete(cb);
      },
      ack: async (ids) => {
        const drop = new Set(ids);
        this.rows = this.rows.filter((r) => !drop.has(r.id));
      },
    };
  }
}
