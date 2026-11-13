import { describe, expect, it } from "vitest";
import { createDeviceSecret, type DeviceSecret } from "./identity";
import type { ResolvedPreKeyBundle } from "./x3dh";
import { deserializeSession, serializeSession } from "./session";
import {
  InMemorySessionStore,
  MessagingService,
  type BundleSource,
  type InboundMessage,
} from "./messaging";
import { InMemoryMessageBus } from "@/lib/transport/transport";

/** A shared in-memory key directory that hands out prekey bundles (consuming OTKs). */
class InMemoryDirectory implements BundleSource {
  private entries = new Map<
    string,
    { base: Omit<ResolvedPreKeyBundle, "oneTimePreKey" | "oneTimePreKeyId">; otks: { id: number; pub: Uint8Array }[] }
  >();

  publish(userId: string, secret: DeviceSecret) {
    this.entries.set(userId, {
      base: {
        deviceId: secret.deviceId,
        identityKey: secret.identityEd.pub,
        signedPreKey: secret.signedPreKey.keyPair.pub,
        signedPreKeyId: secret.signedPreKey.id,
        signedPreKeySignature: secret.signedPreKey.signature,
        registrationId: secret.registrationId,
      },
      otks: secret.oneTimePreKeys.map((o) => ({ id: o.id, pub: o.keyPair.pub })),
    });
  }

  async claimBundle(userId: string): Promise<ResolvedPreKeyBundle | undefined> {
    const e = this.entries.get(userId);
    if (!e) return undefined;
    const otk = e.otks.shift();
    return { ...e.base, oneTimePreKey: otk?.pub, oneTimePreKeyId: otk?.id };
  }
}

async function waitFor(cond: () => boolean, ms = 1000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function setup() {
  const bus = new InMemoryMessageBus();
  const dir = new InMemoryDirectory();
  const aliceSecret = createDeviceSecret(10);
  const bobSecret = createDeviceSecret(10);
  dir.publish("alice", aliceSecret);
  dir.publish("bob", bobSecret);

  const aliceStore = new InMemorySessionStore();
  const alice = new MessagingService(aliceSecret, "alice", dir, bus.forDevice("alice", aliceSecret.deviceId), aliceStore);
  const bob = new MessagingService(bobSecret, "bob", dir, bus.forDevice("bob", bobSecret.deviceId));

  const aliceInbox: InboundMessage[] = [];
  const bobInbox: InboundMessage[] = [];
  alice.onMessage = (m) => aliceInbox.push(m);
  bob.onMessage = (m) => bobInbox.push(m);

  return { bus, dir, aliceSecret, bobSecret, alice, bob, aliceStore, aliceInbox, bobInbox };
}

describe("MessagingService transport", () => {
  it("delivers a message via the offline queue (recipient offline at send time)", async () => {
    const { bus, bobSecret, alice, bob, bobInbox } = setup();

    // Bob is offline; Alice sends.
    await alice.sendText("bob", "hello from alice");

    // The relay holds exactly one opaque envelope, and it is NOT the plaintext.
    const queued = await bus.forDevice("bob", bobSecret.deviceId).fetchQueued();
    expect(queued).toHaveLength(1);
    expect(queued[0].ciphertext).not.toContain("hello");

    // Bob comes online and drains the queue.
    await bob.start();
    await waitFor(() => bobInbox.length === 1);
    expect(bobInbox[0]).toMatchObject({ from: "alice", text: "hello from alice" });

    // Queue drained after ack.
    expect(await bus.forDevice("bob", bobSecret.deviceId).fetchQueued()).toHaveLength(0);
    bob.stop();
  });

  it("delivers in realtime and ratchets a back-and-forth", async () => {
    const { alice, bob, aliceInbox, bobInbox } = setup();
    await alice.start();
    await bob.start();

    await alice.sendText("bob", "hi bob");
    await waitFor(() => bobInbox.length === 1);
    expect(bobInbox[0].text).toBe("hi bob");

    await bob.sendText("alice", "hey alice");
    await waitFor(() => aliceInbox.length === 1);
    expect(aliceInbox[0].text).toBe("hey alice");

    for (let i = 0; i < 4; i++) {
      await alice.sendText("bob", `a${i}`);
      await waitFor(() => bobInbox.length === 2 + i);
      await bob.sendText("alice", `b${i}`);
      await waitFor(() => aliceInbox.length === 2 + i);
    }
    expect(bobInbox.map((m) => m.text)).toEqual(["hi bob", "a0", "a1", "a2", "a3"]);
    expect(aliceInbox.map((m) => m.text)).toEqual(["hey alice", "b0", "b1", "b2", "b3"]);

    alice.stop();
    bob.stop();
  });

  it("keeps the session usable after serialize/deserialize (reload)", async () => {
    const { bus, dir, aliceSecret, alice, bob, aliceStore, bobInbox } = setup();
    await bob.start();

    // Establish + first message.
    await alice.sendText("bob", "before reload");
    await waitFor(() => bobInbox.length === 1);

    // Simulate Alice reloading: persist her session, rebuild from the blob.
    const rec = await aliceStore.load("bob");
    expect(rec).toBeDefined();
    const blob = serializeSession(rec!.session);
    const restoredStore = new InMemorySessionStore();
    await restoredStore.save({ peerUserId: "bob", peerDevice: rec!.peerDevice, session: deserializeSession(blob) });

    const alice2 = new MessagingService(aliceSecret, "alice", dir, bus.forDevice("alice", aliceSecret.deviceId), restoredStore);
    await alice2.sendText("bob", "after reload");
    await waitFor(() => bobInbox.length === 2);
    expect(bobInbox.map((m) => m.text)).toEqual(["before reload", "after reload"]);

    bob.stop();
  });
});
