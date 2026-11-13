import { describe, expect, it } from "vitest";
import { createDeviceSecret, type DeviceSecret } from "./identity";
import type { ResolvedPreKeyBundle } from "./x3dh";
import { deserializeSession, serializeSession } from "./session";
import {
  InMemorySessionStore,
  MessagingService,
  type BundleSource,
  type InboundMessage,
  type Receipt,
} from "./messaging";
import { InMemoryMessageBus } from "@/lib/transport/transport";

type DeviceEntry = {
  base: Omit<ResolvedPreKeyBundle, "oneTimePreKey" | "oneTimePreKeyId">;
  otks: { id: number; pub: Uint8Array }[];
};

/** Shared in-memory directory supporting multiple devices per user. */
class InMemoryDirectory implements BundleSource {
  private devices = new Map<string, Map<string, DeviceEntry>>(); // userId -> deviceId -> entry

  publish(userId: string, secret: DeviceSecret) {
    const dmap = this.devices.get(userId) ?? new Map<string, DeviceEntry>();
    dmap.set(secret.deviceId, {
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
    this.devices.set(userId, dmap);
  }

  async deviceList(userId: string) {
    const dmap = this.devices.get(userId);
    return dmap ? { userId, deviceIds: [...dmap.keys()] } : undefined;
  }

  async claimBundle(userId: string, deviceId?: string): Promise<ResolvedPreKeyBundle | undefined> {
    const dmap = this.devices.get(userId);
    if (!dmap) return undefined;
    const id = deviceId ?? dmap.keys().next().value;
    const e = id ? dmap.get(id) : undefined;
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

function service(bus: InMemoryMessageBus, dir: InMemoryDirectory, secret: DeviceSecret, userId: string) {
  const inbox: InboundMessage[] = [];
  const svc = new MessagingService(secret, userId, dir, bus.forDevice(userId, secret.deviceId));
  svc.onMessage = (m) => inbox.push(m);
  return { svc, inbox };
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

    await alice.sendText("bob", "hello from alice");

    const queued = await bus.forDevice("bob", bobSecret.deviceId).fetchQueued();
    expect(queued).toHaveLength(1);
    expect(queued[0].ciphertext).not.toContain("hello");

    await bob.start();
    await waitFor(() => bobInbox.length === 1);
    expect(bobInbox[0]).toMatchObject({ from: "alice", text: "hello from alice", outgoing: false });

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
    const { bus, dir, aliceSecret, bobSecret, alice, bob, aliceStore, bobInbox } = setup();
    await bob.start();

    await alice.sendText("bob", "before reload");
    await waitFor(() => bobInbox.length === 1);

    // Simulate Alice reloading: persist her session, rebuild from the blob.
    const rec = await aliceStore.load("bob", bobSecret.deviceId);
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

describe("receipts", () => {
  it("acknowledges delivery automatically and read on request", async () => {
    const { alice, bob, bobInbox } = setup();
    const aliceReceipts: Receipt[] = [];
    alice.onReceipt = (r) => aliceReceipts.push(r);
    await alice.start();
    await bob.start();

    await alice.sendText("bob", "ping", "msg-1");
    await waitFor(() => bobInbox.length === 1);
    // Bob's device auto-acks delivery.
    await waitFor(() => aliceReceipts.some((r) => r.kind === "delivered" && r.ids.includes("msg-1")));
    // Bob reads the conversation.
    await bob.sendReceipt("alice", "read", ["msg-1"]);
    await waitFor(() => aliceReceipts.some((r) => r.kind === "read" && r.ids.includes("msg-1")));

    alice.stop();
    bob.stop();
  });
});

describe("multi-device fan-out", () => {
  it("fans a message out to every one of the recipient's devices", async () => {
    const bus = new InMemoryMessageBus();
    const dir = new InMemoryDirectory();
    const aliceSecret = createDeviceSecret(10);
    const bob1 = createDeviceSecret(10);
    const bob2 = createDeviceSecret(10);
    dir.publish("alice", aliceSecret);
    dir.publish("bob", bob1);
    dir.publish("bob", bob2);

    const alice = new MessagingService(aliceSecret, "alice", dir, bus.forDevice("alice", aliceSecret.deviceId));
    const b1 = service(bus, dir, bob1, "bob");
    const b2 = service(bus, dir, bob2, "bob");
    await b1.svc.start();
    await b2.svc.start();

    await alice.sendText("bob", "to all bob devices");
    await waitFor(() => b1.inbox.length === 1 && b2.inbox.length === 1);
    expect(b1.inbox[0]).toMatchObject({ from: "alice", text: "to all bob devices", outgoing: false });
    expect(b2.inbox[0]).toMatchObject({ from: "alice", text: "to all bob devices", outgoing: false });

    b1.svc.stop();
    b2.svc.stop();
  });

  it("syncs a sent message to the sender's own other devices", async () => {
    const bus = new InMemoryMessageBus();
    const dir = new InMemoryDirectory();
    const alice1 = createDeviceSecret(10);
    const alice2 = createDeviceSecret(10);
    const bobSecret = createDeviceSecret(10);
    dir.publish("alice", alice1);
    dir.publish("alice", alice2);
    dir.publish("bob", bobSecret);

    const a1 = new MessagingService(alice1, "alice", dir, bus.forDevice("alice", alice1.deviceId));
    const a2 = service(bus, dir, alice2, "alice");
    const bob = service(bus, dir, bobSecret, "bob");
    await a2.svc.start();
    await bob.svc.start();

    await a1.sendText("bob", "hi from my laptop");
    await waitFor(() => bob.inbox.length === 1 && a2.inbox.length === 1);

    // Bob sees an inbound message from alice.
    expect(bob.inbox[0]).toMatchObject({ from: "alice", text: "hi from my laptop", outgoing: false });
    // Alice's second device sees it as its OWN outgoing message, in the chat with bob.
    expect(a2.inbox[0]).toMatchObject({ from: "bob", text: "hi from my laptop", outgoing: true });

    a2.svc.stop();
    bob.svc.stop();
  });
});
