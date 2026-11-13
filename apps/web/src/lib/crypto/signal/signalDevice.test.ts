import { describe, expect, it } from "vitest";
import {
  addressOf,
  createSignalDevice,
  decryptSignal,
  encryptSignal,
  establishSession,
  signalSafetyNumber,
  type ClaimedSignalBundle,
  type SignalPublicBundle,
} from "./signalDevice";
import { SignalStore } from "./signalStore";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function claim(bundle: SignalPublicBundle, otkIndex = 0): ClaimedSignalBundle {
  const otk = bundle.oneTimePreKeys[otkIndex];
  return {
    registrationId: bundle.registrationId,
    identityKey: bundle.identityKey,
    signedPreKeyId: bundle.signedPreKeyId,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    oneTimePreKeyId: otk.keyId,
    oneTimePreKey: otk.publicKey,
  };
}

describe("libsignal engine", () => {
  it("establishes a session from a bundle and ratchets both ways", async () => {
    const alice = await createSignalDevice(5);
    const bob = await createSignalDevice(5);
    const bobAddr = addressOf("bob", "d1");
    const aliceAddr = addressOf("alice", "d1");

    await establishSession(alice.store, bobAddr, claim(bob.bundle));
    const m1 = await encryptSignal(alice.store, bobAddr, enc("hello bob"));
    expect(m1.type).toBe(3);
    expect(dec(await decryptSignal(bob.store, aliceAddr, m1))).toBe("hello bob");

    const m2 = await encryptSignal(bob.store, aliceAddr, enc("hi alice"));
    expect(dec(await decryptSignal(alice.store, bobAddr, m2))).toBe("hi alice");

    for (let i = 0; i < 4; i++) {
      const a = await encryptSignal(alice.store, bobAddr, enc(`a${i}`));
      expect(dec(await decryptSignal(bob.store, aliceAddr, a))).toBe(`a${i}`);
      const b = await encryptSignal(bob.store, aliceAddr, enc(`b${i}`));
      expect(dec(await decryptSignal(alice.store, bobAddr, b))).toBe(`b${i}`);
    }
  });

  it("handles out-of-order delivery", async () => {
    const alice = await createSignalDevice(5);
    const bob = await createSignalDevice(5);
    const bobAddr = addressOf("bob", "d1");
    const aliceAddr = addressOf("alice", "d1");
    await establishSession(alice.store, bobAddr, claim(bob.bundle));
    // establish both directions
    const hello = await encryptSignal(alice.store, bobAddr, enc("hi"));
    await decryptSignal(bob.store, aliceAddr, hello);

    const m0 = await encryptSignal(bob.store, aliceAddr, enc("m0"));
    const m1 = await encryptSignal(bob.store, aliceAddr, enc("m1"));
    const m2 = await encryptSignal(bob.store, aliceAddr, enc("m2"));
    expect(dec(await decryptSignal(alice.store, bobAddr, m2))).toBe("m2");
    expect(dec(await decryptSignal(alice.store, bobAddr, m0))).toBe("m0");
    expect(dec(await decryptSignal(alice.store, bobAddr, m1))).toBe("m1");
  });

  it("keeps the session usable after store serialize/deserialize", async () => {
    const alice = await createSignalDevice(5);
    const bob = await createSignalDevice(5);
    const bobAddr = addressOf("bob", "d1");
    const aliceAddr = addressOf("alice", "d1");
    await establishSession(alice.store, bobAddr, claim(bob.bundle));
    const first = await encryptSignal(alice.store, bobAddr, enc("before"));
    await decryptSignal(bob.store, aliceAddr, first);

    const restored = SignalStore.deserialize(alice.store.serialize());
    const after = await encryptSignal(restored, bobAddr, enc("after reload"));
    expect(dec(await decryptSignal(bob.store, aliceAddr, after))).toBe("after reload");
  });

  it("computes a stable safety number for both parties", async () => {
    const alice = await createSignalDevice(1);
    const bob = await createSignalDevice(1);
    const sn1 = await signalSafetyNumber("alice", alice.bundle.identityKey, "bob", bob.bundle.identityKey);
    const sn2 = await signalSafetyNumber("bob", bob.bundle.identityKey, "alice", alice.bundle.identityKey);
    expect(sn1).toBe(sn2);
    expect(sn1.length).toBeGreaterThan(0);
  });
});
