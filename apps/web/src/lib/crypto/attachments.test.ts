import { describe, expect, it } from "vitest";
import { decryptBytes, encryptBytes } from "./attachments";

describe("attachment encryption", () => {
  it("round-trips a blob and never stores the plaintext", async () => {
    const data = new Uint8Array(2048);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256;

    const enc = await encryptBytes(data);
    expect(Array.from(enc.ciphertext)).not.toEqual(Array.from(data));

    const out = await decryptBytes(enc.ciphertext, enc.key, enc.iv);
    expect(Array.from(out)).toEqual(Array.from(data));
  });

  it("rejects the wrong key", async () => {
    const enc = await encryptBytes(new Uint8Array([1, 2, 3, 4]));
    const other = await encryptBytes(new Uint8Array([9]));
    await expect(decryptBytes(enc.ciphertext, other.key, enc.iv)).rejects.toThrow();
  });
});
