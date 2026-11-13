/**
 * Dev harness (gated by PEER=1): acts as a second real account "B", publishes
 * its keys, and sends an encrypted message to a target @username. Used to verify
 * the chat UI receives real E2E messages. Never runs in normal test/CI.
 *
 * Run: from apps/web,
 *   PEER=1 PEER_TARGET=alicewire77 PEER_MSG="hi" \
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
 *   node ../../node_modules/vitest/vitest.mjs run src/lib/transport/live.peer.test.ts
 */

import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createDeviceSecret } from "@/lib/crypto/identity";
import { SupabaseKeyDirectory } from "@/lib/crypto/supabaseDirectory";
import { MessagingService } from "@/lib/crypto/messaging";
import { SupabaseTransport } from "@/lib/transport/supabaseTransport";

declare const process: { env: Record<string, string | undefined> };

const PEER = process.env.PEER === "1";
const URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? process.env.VITE_SUPABASE_URL;
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? process.env.VITE_SUPABASE_ANON_KEY;
const TARGET = process.env.PEER_TARGET ?? "";
const MSG = process.env.PEER_MSG ?? "Hey — this is an end-to-end encrypted message.";

describe.skipIf(!PEER || !URL || !ANON)("peer sender", () => {
  it(
    "sends an encrypted message to the target username",
    async () => {
      const suffix = Date.now().toString().slice(-6);
      const username = process.env.PEER_USERNAME ?? `bobwire${suffix}`;
      const client = createClient(URL, ANON, { auth: { persistSession: false, storageKey: "peerB" } });

      const { data, error } = await client.auth.signUp({
        email: `${username}@example.com`,
        password: `Peer-${suffix}-Pass9x`,
        options: { data: { username } },
      });
      if (error) throw error;
      const uid = data.user!.id;

      const secret = createDeviceSecret(20);
      const dir = new SupabaseKeyDirectory([], client);
      await dir.publishKeys(secret, uid);

      const target = await dir.findUserByUsername(TARGET);
      expect(target, `target @${TARGET} must exist`).toBeTruthy();

      const svc = new MessagingService(
        secret,
        uid,
        dir,
        new SupabaseTransport(client, uid, secret.deviceId),
      );
      await svc.sendText(target!.userId, MSG);

      // eslint-disable-next-line no-console
      console.log(`[peer] @${username} (uid ${uid.slice(0, 8)}) sent to @${TARGET}: "${MSG}"`);
    },
    40000,
  );
});
