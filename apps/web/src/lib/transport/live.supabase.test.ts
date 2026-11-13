/**
 * LIVE integration test against the real Supabase project. Skipped unless run
 * with LIVE=1 (so `npm test` / CI never touch the network or create accounts).
 *
 * Run: from apps/web, `LIVE=1 node ../../node_modules/vitest/vitest.mjs run \
 *   src/lib/transport/live.supabase.test.ts`
 *
 * It signs up two throwaway accounts, publishes their key bundles, and sends an
 * encrypted message end-to-end through the real `messages` table — verifying the
 * offline queue, realtime delivery, and that the server row holds only opaque
 * ciphertext (not the plaintext).
 */

import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDeviceSecret, type DeviceSecret } from "@/lib/crypto/identity";
import { SupabaseKeyDirectory } from "@/lib/crypto/supabaseDirectory";
import { MessagingService, type InboundMessage } from "@/lib/crypto/messaging";
import { SupabaseTransport } from "@/lib/transport/supabaseTransport";

declare const process: { env: Record<string, string | undefined> };

const LIVE = process.env.LIVE === "1";
const URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? process.env.VITE_SUPABASE_URL;
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? process.env.VITE_SUPABASE_ANON_KEY;

async function waitFor(cond: () => boolean, ms = 10000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const cleanups: Array<() => Promise<void>> = [];

describe.skipIf(!LIVE || !URL || !ANON)("live Supabase transport", () => {
  afterAll(async () => {
    for (const fn of cleanups) {
      try {
        await fn();
      } catch {
        /* best-effort */
      }
    }
  });

  it(
    "delivers an encrypted message end-to-end through the real relay",
    async () => {
      const suffix = Date.now().toString().slice(-10);
      const mkClient = (tag: string): SupabaseClient =>
        createClient(URL, ANON, { auth: { persistSession: false, storageKey: `rlt-${tag}` } });

      const clientA = mkClient("a");
      const clientB = mkClient("b");

      // Two throwaway accounts (email autoconfirm is on → immediate session).
      const signUp = async (client: SupabaseClient, tag: string) => {
        const email = `ravenlive_${suffix}_${tag}@example.com`;
        const password = `Live-${suffix}-${tag}-Pass9x`;
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { username: `rlt${suffix}${tag}` } },
        });
        if (error) throw error;
        if (!data.session || !data.user) throw new Error("no session from signUp");
        return data.user.id;
      };

      const aliceUid = await signUp(clientA, "a");
      const bobUid = await signUp(clientB, "b");

      const aliceSecret: DeviceSecret = createDeviceSecret(5);
      const bobSecret: DeviceSecret = createDeviceSecret(5);

      const dirA = new SupabaseKeyDirectory([], clientA);
      const dirB = new SupabaseKeyDirectory([], clientB);
      await dirA.publishKeys(aliceSecret, aliceUid);
      await dirB.publishKeys(bobSecret, bobUid);

      // cleanup: drop device rows + any messages, then sign out
      cleanups.push(async () => {
        await clientA.from("devices").delete().eq("id", aliceSecret.deviceId);
        await clientB.from("devices").delete().eq("id", bobSecret.deviceId);
        await clientB.from("messages").delete().eq("recipient_user", bobUid);
        await clientA.auth.signOut();
        await clientB.auth.signOut();
      });

      const alice = new MessagingService(
        aliceSecret,
        aliceUid,
        dirA,
        new SupabaseTransport(clientA, aliceUid, aliceSecret.deviceId),
      );
      const bob = new MessagingService(
        bobSecret,
        bobUid,
        dirB,
        new SupabaseTransport(clientB, bobUid, bobSecret.deviceId),
      );
      const bobInbox: InboundMessage[] = [];
      bob.onMessage = (m) => bobInbox.push(m);

      // Realtime postgres_changes enforces RLS using the socket's auth token.
      const { data: bobSession } = await clientB.auth.getSession();
      if (bobSession.session) clientB.realtime.setAuth(bobSession.session.access_token);

      // --- offline queue path: Bob offline, Alice sends ---
      await alice.sendText(bobUid, "live e2e hello");

      // The server row exists and holds opaque ciphertext, not the plaintext.
      const { data: rows, error: readErr } = await clientB
        .from("messages")
        .select("ciphertext,sender_device,recipient_device")
        .eq("recipient_user", bobUid);
      expect(readErr).toBeNull();
      expect(rows!.length).toBeGreaterThanOrEqual(1);
      expect(rows![0].ciphertext).not.toContain("hello");
      expect(rows![0].recipient_device).toBe(bobSecret.deviceId);

      // Bob comes online: drains the queue (and subscribes for realtime).
      await bob.start();
      await waitFor(() => bobInbox.length >= 1);
      expect(bobInbox[0].text).toBe("live e2e hello");
      expect(bobInbox[0].from).toBe(aliceUid);

      // --- realtime path: Bob is subscribed, Alice sends again ---
      // Let the realtime channel finish joining (postgres_changes doesn't backfill).
      await new Promise((r) => setTimeout(r, 4000));
      await alice.sendText(bobUid, "second via realtime");
      await waitFor(() => bobInbox.length >= 2, 15000);
      expect(bobInbox[1].text).toBe("second via realtime");

      bob.stop();
      // eslint-disable-next-line no-console
      console.log(`[live] OK — 2 messages delivered E2E (alice=${aliceUid.slice(0, 8)} bob=${bobUid.slice(0, 8)})`);
    },
    60000,
  );
});
