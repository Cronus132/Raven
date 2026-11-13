import { describe, expect, it } from "vitest";
import { createSignalDevice, type SignalPublicBundle } from "./signal/signalDevice";
import { SignalStore } from "./signal/signalStore";
import { SignalSessionEngine } from "./sessionEngine";
import type { ResolvedPreKeyBundle } from "./x3dh";
import { fromBase64 } from "./primitives";
import {
  MessagingService,
  type BundleSource,
  type InboundGroupMessage,
  type InboundMessage,
  type Receipt,
} from "./messaging";
import { InMemoryMessageBus } from "@/lib/transport/transport";

type DeviceEntry = { bundle: SignalPublicBundle; otkIdx: number };

/** In-memory directory holding libsignal bundles, supporting multiple devices per user. */
class InMemoryDirectory implements BundleSource {
  private devices = new Map<string, Map<string, DeviceEntry>>();

  publish(userId: string, deviceId: string, bundle: SignalPublicBundle) {
    const dmap = this.devices.get(userId) ?? new Map<string, DeviceEntry>();
    dmap.set(deviceId, { bundle, otkIdx: 0 });
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
    if (!e || !id) return undefined;
    const otk = e.bundle.oneTimePreKeys[e.otkIdx++];
    return {
      deviceId: id,
      registrationId: e.bundle.registrationId,
      identityKey: fromBase64(e.bundle.identityKey),
      signedPreKeyId: e.bundle.signedPreKeyId,
      signedPreKey: fromBase64(e.bundle.signedPreKey),
      signedPreKeySignature: fromBase64(e.bundle.signedPreKeySignature),
      oneTimePreKey: otk ? fromBase64(otk.publicKey) : undefined,
      oneTimePreKeyId: otk?.keyId,
    };
  }
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function makeMember(bus: InMemoryMessageBus, dir: InMemoryDirectory, userId: string, deviceId: string) {
  const dev = await createSignalDevice(20);
  dir.publish(userId, deviceId, dev.bundle);
  const engine = new SignalSessionEngine(dev.store, deviceId, dev.bundle.identityKey);
  const svc = new MessagingService(engine, userId, dir, bus.forDevice(userId, deviceId));
  const inbox: InboundMessage[] = [];
  const groupInbox: InboundGroupMessage[] = [];
  svc.onMessage = (m) => inbox.push(m);
  svc.onGroupMessage = (m) => groupInbox.push(m);
  return { dev, engine, svc, inbox, groupInbox, deviceId };
}

async function setup() {
  const bus = new InMemoryMessageBus();
  const dir = new InMemoryDirectory();
  const alice = await makeMember(bus, dir, "alice", "alice-d1");
  const bob = await makeMember(bus, dir, "bob", "bob-d1");
  return { bus, dir, alice, bob };
}

describe("MessagingService (libsignal engine)", () => {
  it("delivers via the offline queue (recipient offline at send time)", async () => {
    const { bus, alice, bob } = await setup();
    await alice.svc.sendText("bob", "hello from alice");

    const queued = await bus.forDevice("bob", "bob-d1").fetchQueued();
    expect(queued).toHaveLength(1);
    expect(queued[0].ciphertext).not.toContain("hello");

    await bob.svc.start();
    await waitFor(() => bob.inbox.length === 1);
    expect(bob.inbox[0]).toMatchObject({ from: "alice", text: "hello from alice", outgoing: false });
    expect(await bus.forDevice("bob", "bob-d1").fetchQueued()).toHaveLength(0);
    bob.svc.stop();
  });

  it("ratchets a realtime back-and-forth", async () => {
    const { alice, bob } = await setup();
    await alice.svc.start();
    await bob.svc.start();

    await alice.svc.sendText("bob", "hi bob");
    await waitFor(() => bob.inbox.length === 1);
    await bob.svc.sendText("alice", "hey alice");
    await waitFor(() => alice.inbox.length === 1);
    for (let i = 0; i < 4; i++) {
      await alice.svc.sendText("bob", `a${i}`);
      await waitFor(() => bob.inbox.length === 2 + i);
      await bob.svc.sendText("alice", `b${i}`);
      await waitFor(() => alice.inbox.length === 2 + i);
    }
    expect(bob.inbox.map((m) => m.text)).toEqual(["hi bob", "a0", "a1", "a2", "a3"]);
    expect(alice.inbox.map((m) => m.text)).toEqual(["hey alice", "b0", "b1", "b2", "b3"]);
    alice.svc.stop();
    bob.svc.stop();
  });

  it("keeps the session usable after store serialize/deserialize", async () => {
    const { bus, dir, alice, bob } = await setup();
    await bob.svc.start();
    await alice.svc.sendText("bob", "before reload");
    await waitFor(() => bob.inbox.length === 1);

    const restored = SignalStore.deserialize(alice.dev.store.serialize());
    const engine2 = new SignalSessionEngine(restored, "alice-d1", alice.dev.bundle.identityKey);
    const alice2 = new MessagingService(engine2, "alice", dir, bus.forDevice("alice", "alice-d1"));
    await alice2.sendText("bob", "after reload");
    await waitFor(() => bob.inbox.length === 2);
    expect(bob.inbox.map((m) => m.text)).toEqual(["before reload", "after reload"]);
    bob.svc.stop();
  });

  it("acknowledges delivery automatically and read on request", async () => {
    const { alice, bob } = await setup();
    const receipts: Receipt[] = [];
    alice.svc.onReceipt = (r) => receipts.push(r);
    await alice.svc.start();
    await bob.svc.start();
    await alice.svc.sendText("bob", "ping", "msg-1");
    await waitFor(() => bob.inbox.length === 1);
    await waitFor(() => receipts.some((r) => r.kind === "delivered" && r.ids.includes("msg-1")));
    await bob.svc.sendReceipt("alice", "read", ["msg-1"]);
    await waitFor(() => receipts.some((r) => r.kind === "read" && r.ids.includes("msg-1")));
    alice.svc.stop();
    bob.svc.stop();
  });
});

describe("multi-device + groups (libsignal engine)", () => {
  it("fans out to every recipient device and syncs to the sender's own devices", async () => {
    const bus = new InMemoryMessageBus();
    const dir = new InMemoryDirectory();
    const alice1 = await makeMember(bus, dir, "alice", "alice-d1");
    const alice2 = await makeMember(bus, dir, "alice", "alice-d2");
    const bob1 = await makeMember(bus, dir, "bob", "bob-d1");
    const bob2 = await makeMember(bus, dir, "bob", "bob-d2");
    await alice2.svc.start();
    await bob1.svc.start();
    await bob2.svc.start();

    await alice1.svc.sendText("bob", "hi everyone");
    await waitFor(() => bob1.inbox.length === 1 && bob2.inbox.length === 1 && alice2.inbox.length === 1);
    expect(bob1.inbox[0]).toMatchObject({ from: "alice", text: "hi everyone", outgoing: false });
    expect(bob2.inbox[0].text).toBe("hi everyone");
    // alice's second device sees it as its own outgoing message, in the chat with bob
    expect(alice2.inbox[0]).toMatchObject({ from: "bob", text: "hi everyone", outgoing: true });
    alice2.svc.stop();
    bob1.svc.stop();
    bob2.svc.stop();
  });

  it("delivers a group message to every member and supports replies", async () => {
    const bus = new InMemoryMessageBus();
    const dir = new InMemoryDirectory();
    const A = await makeMember(bus, dir, "A", "A-d1");
    const B = await makeMember(bus, dir, "B", "B-d1");
    const C = await makeMember(bus, dir, "C", "C-d1");
    await A.svc.start();
    await B.svc.start();
    await C.svc.start();

    const gid = "grp-1";
    await A.svc.createGroup(gid, "Team", ["B", "C"]);
    await A.svc.sendGroupText(gid, "hello team", "m1");
    await waitFor(() => B.groupInbox.length >= 1 && C.groupInbox.length >= 1);
    expect(B.groupInbox[0]).toMatchObject({ groupId: gid, from: "A", text: "hello team", outgoing: false });
    expect(C.groupInbox[0].text).toBe("hello team");

    await B.svc.sendGroupText(gid, "hey all", "m2");
    await waitFor(() => A.groupInbox.some((x) => x.text === "hey all") && C.groupInbox.some((x) => x.text === "hey all"));
    A.svc.stop();
    B.svc.stop();
    C.svc.stop();
  });
});
