/**
 * Dev harness (PEER=1): a second real account "B" on the libsignal engine that
 * sends an encrypted text message to a target @username — used to verify the
 * app's receive path in the browser. Never runs in normal test/CI.
 *
 * Run: from apps/web,
 *   PEER=1 PEER_TARGET=<username> PEER_MSG="hi" \
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
 *   node ../../node_modules/vitest/vitest.mjs run src/lib/transport/live.signalpeer.test.ts
 */

import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  addressOf,
  createSignalDevice,
  encryptSignal,
  establishSession,
  serializeSignalMessage,
  type ClaimedSignalBundle,
  type SignalPublicBundle,
} from "@/lib/crypto/signal/signalDevice";
import { SupabaseTransport } from "./supabaseTransport";

declare const process: { env: Record<string, string | undefined> };
const PEER = process.env.PEER === "1";
const URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? process.env.VITE_SUPABASE_URL;
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? process.env.VITE_SUPABASE_ANON_KEY;
const TARGET = process.env.PEER_TARGET ?? "";
const MSG = process.env.PEER_MSG ?? "end-to-end encrypted hello";

async function publishBundle(c: SupabaseClient, uid: string, deviceId: string, b: SignalPublicBundle) {
  await c.from("devices").upsert({ id: deviceId, user_id: uid, registration_id: b.registrationId, identity_key: b.identityKey, last_seen_at: new Date().toISOString() });
  await c.from("signed_prekeys").upsert({ device_id: deviceId, key_id: b.signedPreKeyId, public_key: b.signedPreKey, signature: b.signedPreKeySignature });
  await c.from("one_time_prekeys").upsert(b.oneTimePreKeys.map((o) => ({ device_id: deviceId, key_id: o.keyId, public_key: o.publicKey })));
}

describe.skipIf(!PEER || !URL || !ANON || !TARGET)("signal peer sender", () => {
  it("sends an encrypted text message to the target username", async () => {
    const suffix = Date.now().toString().slice(-6);
    const username = process.env.PEER_USERNAME ?? `bobsig${suffix}`;
    const client = createClient(URL, ANON, { auth: { persistSession: false, storageKey: "sigpeer" } });
    const { data, error } = await client.auth.signUp({
      email: `${username}@example.com`,
      password: `Peer-${suffix}-9x`,
      options: { data: { username } },
    });
    if (error) throw error;
    const uid = data.user!.id;
    const deviceId = `sdev_${suffix}`;

    const dev = await createSignalDevice(10);
    await publishBundle(client, uid, deviceId, dev.bundle);

    // Resolve the target account + claim its bundle.
    const { data: prof } = await client.from("profiles").select("id").eq("username", TARGET).limit(1);
    const targetUid = (prof?.[0] as { id: string } | undefined)?.id;
    expect(targetUid, `target @${TARGET} must exist`).toBeTruthy();
    const { data: devRow } = await client.from("devices").select("id").eq("user_id", targetUid!).limit(1);
    const targetDevice = (devRow?.[0] as { id: string } | undefined)?.id;
    expect(targetDevice, "target device must exist").toBeTruthy();
    const { data: claimed } = await client.rpc("claim_prekey_bundle", { p_device_id: targetDevice });

    const targetAddr = addressOf(targetUid!, targetDevice!);
    await establishSession(dev.store, targetAddr, claimed as ClaimedSignalBundle);

    // Encode the app's text payload and encrypt it for the target.
    const payload = JSON.stringify({ v: 1, t: "text", from: uid, to: targetUid, id: crypto.randomUUID(), body: MSG });
    const wire = serializeSignalMessage(await encryptSignal(dev.store, targetAddr, new TextEncoder().encode(payload)));
    await new SupabaseTransport(client, uid, deviceId).send({
      senderUser: uid,
      senderDevice: deviceId,
      recipientUser: targetUid!,
      recipientDevice: targetDevice!,
      ciphertext: wire,
    });
    // eslint-disable-next-line no-console
    console.log(`[sigpeer] @${username} sent to @${TARGET}: "${MSG}"`);
  }, 40000);
});
