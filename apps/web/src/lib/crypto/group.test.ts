import { describe, expect, it } from "vitest";
import { GroupService } from "./group";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** Wire up a group among members, exchanging sender-key distributions. */
function convene(members: string[]) {
  const svcs = Object.fromEntries(members.map((m) => [m, new GroupService(m)]));
  const gid = "g1";
  for (const m of members) svcs[m].ensureGroup(gid, "Test Group", members);
  // everyone shares their sender key with everyone else
  for (const from of members) {
    const dist = svcs[from].distribution(gid);
    for (const to of members) if (to !== from) svcs[to].applyDistribution(dist, from);
  }
  return { svcs, gid };
}

describe("group messaging (sender keys)", () => {
  it("delivers a message to every member", async () => {
    const { svcs, gid } = convene(["A", "B", "C"]);
    const msg = await svcs.A.encrypt(gid, enc("hello group"));
    expect(dec(await svcs.B.decrypt(gid, "A", msg.iteration, msg.body))).toBe("hello group");
    expect(dec(await svcs.C.decrypt(gid, "A", msg.iteration, msg.body))).toBe("hello group");
  });

  it("supports every member sending", async () => {
    const { svcs, gid } = convene(["A", "B", "C"]);
    const a = await svcs.A.encrypt(gid, enc("from A"));
    const b = await svcs.B.encrypt(gid, enc("from B"));
    const c = await svcs.C.encrypt(gid, enc("from C"));
    expect(dec(await svcs.B.decrypt(gid, "A", a.iteration, a.body))).toBe("from A");
    expect(dec(await svcs.C.decrypt(gid, "A", a.iteration, a.body))).toBe("from A");
    expect(dec(await svcs.A.decrypt(gid, "B", b.iteration, b.body))).toBe("from B");
    expect(dec(await svcs.A.decrypt(gid, "C", c.iteration, c.body))).toBe("from C");
  });

  it("handles out-of-order group messages", async () => {
    const { svcs, gid } = convene(["A", "B"]);
    const m0 = await svcs.A.encrypt(gid, enc("0"));
    const m1 = await svcs.A.encrypt(gid, enc("1"));
    const m2 = await svcs.A.encrypt(gid, enc("2"));
    expect(dec(await svcs.B.decrypt(gid, "A", m2.iteration, m2.body))).toBe("2");
    expect(dec(await svcs.B.decrypt(gid, "A", m0.iteration, m0.body))).toBe("0");
    expect(dec(await svcs.B.decrypt(gid, "A", m1.iteration, m1.body))).toBe("1");
  });

  it("rejects a tampered group ciphertext", async () => {
    const { svcs, gid } = convene(["A", "B"]);
    const m = await svcs.A.encrypt(gid, enc("secret"));
    const bad = new Uint8Array(m.body);
    bad[bad.length - 1] ^= 1;
    await expect(svcs.B.decrypt(gid, "A", m.iteration, bad)).rejects.toThrow();
  });
});
