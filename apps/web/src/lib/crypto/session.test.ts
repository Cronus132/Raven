import { describe, expect, it } from "vitest";
import { createDeviceSecret, type DeviceSecret } from "./identity";
import { x3dhInitiator, x3dhResponder, type ResolvedPreKeyBundle } from "./x3dh";
import {
  decryptMessage,
  encryptMessage,
  startInitiatorSession,
  startResponderSession,
  type DirectMessage,
} from "./session";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function bundleFrom(secret: DeviceSecret, withOtk = true, otkIndex = 0): ResolvedPreKeyBundle {
  const otk = secret.oneTimePreKeys[otkIndex];
  return {
    identityKey: secret.identityEd.pub,
    signedPreKey: secret.signedPreKey.keyPair.pub,
    signedPreKeyId: secret.signedPreKey.id,
    signedPreKeySignature: secret.signedPreKey.signature,
    oneTimePreKey: withOtk ? otk.keyPair.pub : undefined,
    oneTimePreKeyId: withOtk ? otk.id : undefined,
    registrationId: secret.registrationId,
  };
}

/** Establish a live session pair via the first message. */
async function establish(alice: DeviceSecret, bob: DeviceSecret, withOtk = true) {
  const aliceSession = startInitiatorSession(alice, bundleFrom(bob, withOtk));
  const hello = await encryptMessage(aliceSession, enc("hello"));
  expect(hello.preamble, "first message carries the X3DH preamble").toBeDefined();
  const bobSession = startResponderSession(bob, hello.preamble!);
  expect(dec(await decryptMessage(bobSession, hello))).toBe("hello");
  return { aliceSession, bobSession };
}

describe("X3DH", () => {
  it("initiator and responder derive the same shared secret (with a one-time prekey)", () => {
    const alice = createDeviceSecret(5);
    const bob = createDeviceSecret(5);
    const init = x3dhInitiator(alice, bundleFrom(bob));
    const resp = x3dhResponder(bob, init.preamble);
    expect(Array.from(resp.sharedSecret)).toEqual(Array.from(init.sharedSecret));
  });

  it("agrees without a one-time prekey (pool exhausted)", () => {
    const alice = createDeviceSecret(5);
    const bob = createDeviceSecret(5);
    const init = x3dhInitiator(alice, bundleFrom(bob, false));
    expect(init.preamble.oneTimePreKeyId).toBeUndefined();
    const resp = x3dhResponder(bob, init.preamble);
    expect(Array.from(resp.sharedSecret)).toEqual(Array.from(init.sharedSecret));
  });

  it("rejects a tampered signed-prekey signature", () => {
    const alice = createDeviceSecret(5);
    const bob = createDeviceSecret(5);
    const bundle = bundleFrom(bob);
    bundle.signedPreKeySignature = new Uint8Array(bundle.signedPreKeySignature);
    bundle.signedPreKeySignature[0] ^= 0xff;
    expect(() => x3dhInitiator(alice, bundle)).toThrow(/signature/i);
  });
});

describe("Double Ratchet session", () => {
  it("round-trips the first message", async () => {
    await establish(createDeviceSecret(5), createDeviceSecret(5));
  });

  it("ratchets across a back-and-forth conversation", async () => {
    const { aliceSession, bobSession } = await establish(createDeviceSecret(10), createDeviceSecret(10));

    const b1 = await encryptMessage(bobSession, enc("hi alice"));
    expect(dec(await decryptMessage(aliceSession, b1))).toBe("hi alice");
    const a1 = await encryptMessage(aliceSession, enc("how are you"));
    expect(dec(await decryptMessage(bobSession, a1))).toBe("how are you");

    for (let i = 0; i < 5; i++) {
      const fromBob = await encryptMessage(bobSession, enc(`b-${i}`));
      expect(dec(await decryptMessage(aliceSession, fromBob))).toBe(`b-${i}`);
      const fromAlice = await encryptMessage(aliceSession, enc(`a-${i}`));
      expect(dec(await decryptMessage(bobSession, fromAlice))).toBe(`a-${i}`);
    }
  });

  it("delivers out-of-order messages within a chain", async () => {
    const { aliceSession, bobSession } = await establish(createDeviceSecret(10), createDeviceSecret(10));

    const m0 = await encryptMessage(bobSession, enc("m0"));
    const m1 = await encryptMessage(bobSession, enc("m1"));
    const m2 = await encryptMessage(bobSession, enc("m2"));

    // received 0, 2, 1 — the key for m1 must be stashed and reused
    expect(dec(await decryptMessage(aliceSession, m0))).toBe("m0");
    expect(dec(await decryptMessage(aliceSession, m2))).toBe("m2");
    expect(dec(await decryptMessage(aliceSession, m1))).toBe("m1");
  });

  it("survives a dropped message followed by more traffic", async () => {
    const { aliceSession, bobSession } = await establish(createDeviceSecret(10), createDeviceSecret(10));

    await encryptMessage(bobSession, enc("never delivered")); // lost in transit
    const next = await encryptMessage(bobSession, enc("delivered"));
    expect(dec(await decryptMessage(aliceSession, next))).toBe("delivered");

    const reply = await encryptMessage(aliceSession, enc("got it"));
    expect(dec(await decryptMessage(bobSession, reply))).toBe("got it");
  });

  it("rejects a tampered ciphertext (AEAD integrity)", async () => {
    const { aliceSession, bobSession } = await establish(createDeviceSecret(5), createDeviceSecret(5));
    const good = await encryptMessage(bobSession, enc("secret"));
    const tampered: DirectMessage = { ...good, body: new Uint8Array(good.body) };
    tampered.body[tampered.body.length - 1] ^= 0x01;
    await expect(decryptMessage(aliceSession, tampered)).rejects.toThrow();
  });

  it("produces different ciphertext for identical plaintext (no key reuse)", async () => {
    const { aliceSession, bobSession } = await establish(createDeviceSecret(5), createDeviceSecret(5));
    const c1 = await encryptMessage(bobSession, enc("same"));
    const c2 = await encryptMessage(bobSession, enc("same"));
    expect(Array.from(c1.body)).not.toEqual(Array.from(c2.body));
    expect(dec(await decryptMessage(aliceSession, c1))).toBe("same");
    expect(dec(await decryptMessage(aliceSession, c2))).toBe("same");
  });
});
