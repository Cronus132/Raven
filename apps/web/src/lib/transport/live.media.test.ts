/**
 * LIVE check (MEDIA=1) that the encrypted-attachments storage path works against
 * the real project: sign in, upload a ciphertext blob, download + decrypt, and
 * clean up. Skipped unless MEDIA=1. Needs MEDIA_EMAIL + MEDIA_PASS for an
 * existing account.
 *
 * Run: from apps/web,
 *   MEDIA=1 MEDIA_EMAIL=... MEDIA_PASS=... VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
 *   node ../../node_modules/vitest/vitest.mjs run src/lib/transport/live.media.test.ts
 */

import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { decryptBytes, encryptBytes } from "@/lib/crypto/attachments";

declare const process: { env: Record<string, string | undefined> };

const MEDIA = process.env.MEDIA === "1";
const URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? process.env.VITE_SUPABASE_URL;
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? process.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!MEDIA || !URL || !ANON)("live attachments storage", () => {
  it(
    "uploads ciphertext and downloads + decrypts it",
    async () => {
      const client = createClient(URL, ANON, { auth: { persistSession: false, storageKey: "media-test" } });
      const suffix = Date.now().toString().slice(-8);
      const { error: authErr } = await client.auth.signUp({
        email: `mediatest${suffix}@example.com`,
        password: `Media-${suffix}-Pass9x`,
        options: { data: { username: `mediatest${suffix}` } },
      });
      expect(authErr, "sign-up must succeed").toBeNull();

      const data = new Uint8Array(1500);
      for (let i = 0; i < data.length; i++) data[i] = (i * 13) % 256;
      const enc = await encryptBytes(data);
      const path = `${crypto.randomUUID()}`;

      const up = await client.storage
        .from("attachments")
        .upload(path, enc.ciphertext, { contentType: "application/octet-stream" });
      expect(up.error, "upload must succeed").toBeNull();

      const dl = await client.storage.from("attachments").download(path);
      expect(dl.error).toBeNull();
      const ct = new Uint8Array(await dl.data!.arrayBuffer());
      const out = await decryptBytes(ct, enc.key, enc.iv);
      expect(Array.from(out)).toEqual(Array.from(data));

      await client.storage.from("attachments").remove([path]);
      // eslint-disable-next-line no-console
      console.log("[media] OK — ciphertext round-trip through the attachments bucket");
    },
    40000,
  );
});
