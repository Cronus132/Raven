/**
 * LIVE end-to-end check (LSIG=1) that the libsignal engine works through the
 * real Supabase directory + message queue: two accounts publish libsignal
 * bundles, establish an X3DH session, and exchange ratcheted messages that the
 * server only ever sees as ciphertext. Skipped unless LSIG=1.
 *
 * Run: from apps/web,
 *   LSIG=1 VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
 *   node ../../node_modules/vitest/vitest.mjs run src/lib/transport/live.libsignal.test.ts
 */

import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  addressOf,
  createSignalDevice,
  decryptSignal,
  deserializeSignalMessage,
  encryptSignal,
  establishSession,
  serializeSignalMessage,
  type ClaimedSignalBundle,
  type SignalPublicBundle,
} from "@/lib/crypto/signal/signalDevice";
import type { SignalStore } from "@/lib/crypto/signal/signalStore";
import { SupabaseTransport } from "./supabaseTransport";

declare const process: { env: Record<string, string | undefined> };
const LSIG = process.env.LSIG === "1";
const URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? process.env.VITE_SUPABASE_URL;
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? process.env.VITE_SUPABASE_ANON_KEY;

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function waitFor(cond: () => boolean, ms = 10000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function publishBundle(client: SupabaseClient, uid: string, deviceId: string, bundle: SignalPublicBundle) {
  await client.from("devices").upsert({
    id: deviceId,
    user_id: uid,
    registration_id: bundle.registrationId,
    identity_key: bundle.identityKey,
    last_seen_at: new Date().toISOString(),
  });
  await client.from("signed_prekeys").upsert({
    device_id: deviceId,
    key_id: bundle.signedPreKeyId,
    public_key: bundle.signedPreKey,
    signature: bundle.signedPreKeySignature,
  });
  await client.from("one_time_prekeys").upsert(
    bundle.oneTimePreKeys.map((o) => ({ device_id: deviceId, key_id: o.keyId, public_key: o.publicKey })),
  );
}

async function claim(client: SupabaseClient, deviceId: string): Promise<ClaimedSignalBundle> {
  const { data } = await client.rpc("claim_prekey_bundle", { p_device_id: deviceId });
  return data as ClaimedSignalBundle;
}

describe.skipIf(!LSIG || !URL || !ANON)("live libsignal through Supabase", () => {
  it(
    "exchanges ratcheted messages between two accounts",
    async () => {
      const suffix = Date.now().toString().slice(-8);
      const mk = () => createClient(URL, ANON, { auth: { persistSession: false, storageKey: `lsig-${Math.random()}` } });
      const clientA = mk();
      const clientB = mk();

      const signUp = async (c: SupabaseClient, tag: string) => {
        const { data, error } = await c.auth.signUp({
          email: `lsig${suffix}${tag}@example.com`,
          password: `Lsig-${suffix}-${tag}-9x`,
          options: { data: { username: `lsig${suffix}${tag}` } },
        });
        if (error) throw error;
        return data.user!.id;
      };
      const aUid = await signUp(clientA, "a");
      const bUid = await signUp(clientB, "b");
      const aDev = `sdev_${suffix}a`;
      const bDev = `sdev_${suffix}b`;

      const a = await createSignalDevice(10);
      const b = await createSignalDevice(10);
      await publishBundle(clientA, aUid, aDev, a.bundle);
      await publishBundle(clientB, bUid, bDev, b.bundle);

      const aStore: SignalStore = a.store;
      const bStore: SignalStore = b.store;
      const transportA = new SupabaseTransport(clientA, aUid, aDev);
      const transportB = new SupabaseTransport(clientB, bUid, bDev);

      // A establishes a session to B and sends.
      const claimedB = await claim(clientA, bDev);
      const bAddrForA = addressOf(bUid, bDev);
      await establishSession(aStore, bAddrForA, claimedB);
      const m1 = await encryptSignal(aStore, bAddrForA, enc("libsignal hello"));
      await transportA.send({
        senderUser: aUid,
        senderDevice: aDev,
        recipientUser: bUid,
        recipientDevice: bDev,
        ciphertext: serializeSignalMessage(m1),
      });

      // B drains and decrypts (auto-establishes from the PreKey message).
      const queuedB = await transportB.fetchQueued();
      expect(queuedB.length).toBe(1);
      expect(queuedB[0].ciphertext).not.toContain("hello");
      const aAddrForB = addressOf(aUid, aDev);
      const p1 = await decryptSignal(bStore, aAddrForB, deserializeSignalMessage(queuedB[0].ciphertext));
      expect(dec(p1)).toBe("libsignal hello");
      await transportB.ack(queuedB.map((q) => q.id));

      // B replies; A decrypts.
      const m2 = await encryptSignal(bStore, aAddrForB, enc("ratcheting back"));
      await transportB.send({
        senderUser: bUid,
        senderDevice: bDev,
        recipientUser: aUid,
        recipientDevice: aDev,
        ciphertext: serializeSignalMessage(m2),
      });
      const queuedA = await transportA.fetchQueued();
      expect(queuedA.length).toBe(1);
      const p2 = await decryptSignal(aStore, bAddrForA, deserializeSignalMessage(queuedA[0].ciphertext));
      expect(dec(p2)).toBe("ratcheting back");

      // cleanup
      await clientA.from("devices").delete().eq("id", aDev);
      await clientB.from("devices").delete().eq("id", bDev);
      await clientA.from("messages").delete().eq("recipient_user", aUid);
      await clientB.from("messages").delete().eq("recipient_user", bUid);
      // eslint-disable-next-line no-console
      console.log("[lsig] OK — libsignal X3DH + ratchet through the real Supabase directory/queue");
      await waitFor(() => true, 1);
    },
    60000,
  );
});
