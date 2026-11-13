/**
 * Supabase-backed key directory.
 *
 * Stores and serves ONLY public key material (identity keys, signed prekeys,
 * one-time prekeys) and device metadata — never private keys or plaintext.
 * Writes are owner-only (RLS: user_id = auth.uid()); one-time prekeys are
 * consumed exactly once via the `claim_prekey_bundle` RPC.
 *
 * Implements the same KeyDirectory interface as LocalKeyDirectory, so the store
 * and UI are unchanged. Demo seed contacts (non-uuid ids) keep deterministic
 * identity keys so their safety numbers still render; real accounts (uuid ids)
 * resolve against the live directory.
 */

import type { PreKeyBundle } from "./engine";
import type { DeviceSecret } from "./identity";
import type { ResolvedPreKeyBundle } from "./x3dh";
import type { BundleSource } from "./messaging";
import { type KeyDirectory, type DirectoryDeviceList, demoIdentityKey } from "./directory";
import { fromBase64, toBase64 } from "./primitives";
import { supabase, isUuid } from "@/lib/backend/supabase";

interface ClaimedBundle {
  deviceId: string;
  userId: string;
  registrationId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKeyId: number | null;
  oneTimePreKey: string | null;
}

function client() {
  if (!supabase) throw new Error("Supabase not configured");
  return supabase;
}

export class SupabaseKeyDirectory implements KeyDirectory, BundleSource {
  private demo = new Map<string, Uint8Array>();

  constructor(demoUserIds: string[] = []) {
    for (const id of demoUserIds) this.demo.set(id, demoIdentityKey(id));
  }

  /** Publish the device's full public key set. `userId` is the account uid (= auth.uid()). */
  async publishKeys(secret: DeviceSecret, userId: string): Promise<void> {
    const db = client();

    const { error: devErr } = await db.from("devices").upsert(
      {
        id: secret.deviceId,
        user_id: userId,
        registration_id: secret.registrationId,
        identity_key: toBase64(secret.identityEd.pub),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (devErr) throw devErr;

    const { error: spkErr } = await db.from("signed_prekeys").upsert(
      {
        device_id: secret.deviceId,
        key_id: secret.signedPreKey.id,
        public_key: toBase64(secret.signedPreKey.keyPair.pub),
        signature: toBase64(secret.signedPreKey.signature),
      },
      { onConflict: "device_id,key_id" },
    );
    if (spkErr) throw spkErr;

    const otks = secret.oneTimePreKeys.map((o) => ({
      device_id: secret.deviceId,
      key_id: o.id,
      public_key: toBase64(o.keyPair.pub),
    }));
    if (otks.length) {
      const { error: otkErr } = await db
        .from("one_time_prekeys")
        .upsert(otks, { onConflict: "device_id,key_id", ignoreDuplicates: true });
      if (otkErr) throw otkErr;
    }
  }

  /** Minimal single-bundle publish (interface fallback; publishKeys is preferred). */
  async publish(bundle: PreKeyBundle): Promise<void> {
    const db = client();
    await db.from("devices").upsert(
      {
        id: bundle.deviceId,
        user_id: bundle.userId,
        registration_id: bundle.registrationId,
        identity_key: toBase64(bundle.identityKey),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    await db.from("signed_prekeys").upsert(
      {
        device_id: bundle.deviceId,
        key_id: 1,
        public_key: toBase64(bundle.signedPreKey),
        signature: toBase64(bundle.signedPreKeySignature),
      },
      { onConflict: "device_id,key_id" },
    );
    if (bundle.oneTimePreKey) {
      await db
        .from("one_time_prekeys")
        .upsert(
          { device_id: bundle.deviceId, key_id: 1, public_key: toBase64(bundle.oneTimePreKey) },
          { onConflict: "device_id,key_id", ignoreDuplicates: true },
        );
    }
  }

  private async primaryDeviceId(userId: string): Promise<string | undefined> {
    const { data } = await client()
      .from("devices")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);
    return data?.[0]?.id as string | undefined;
  }

  async fetchBundle(userId: string, deviceId?: string): Promise<PreKeyBundle | undefined> {
    if (!isUuid(userId)) return undefined; // demo contact: no real bundle to fetch
    const devId = deviceId ?? (await this.primaryDeviceId(userId));
    if (!devId) return undefined;

    const { data, error } = await client().rpc("claim_prekey_bundle", { p_device_id: devId });
    if (error || !data) return undefined;
    const b = data as {
      deviceId: string;
      userId: string;
      registrationId: number;
      identityKey: string;
      signedPreKey: string;
      signedPreKeySignature: string;
      oneTimePreKey: string | null;
    };
    return {
      userId: b.userId,
      deviceId: b.deviceId,
      registrationId: b.registrationId,
      identityKey: fromBase64(b.identityKey),
      signedPreKey: fromBase64(b.signedPreKey),
      signedPreKeySignature: fromBase64(b.signedPreKeySignature),
      oneTimePreKey: b.oneTimePreKey ? fromBase64(b.oneTimePreKey) : undefined,
    };
  }

  /** Claim a prekey bundle for a session, with key ids resolved (consumes one OTK). */
  async claimBundle(userId: string, deviceId?: string): Promise<ResolvedPreKeyBundle | undefined> {
    if (!isUuid(userId)) return undefined;
    const devId = deviceId ?? (await this.primaryDeviceId(userId));
    if (!devId) return undefined;

    const { data, error } = await client().rpc("claim_prekey_bundle", { p_device_id: devId });
    if (error || !data) return undefined;
    const b = data as ClaimedBundle;
    return {
      deviceId: b.deviceId,
      identityKey: fromBase64(b.identityKey),
      signedPreKey: fromBase64(b.signedPreKey),
      signedPreKeyId: b.signedPreKeyId,
      signedPreKeySignature: fromBase64(b.signedPreKeySignature),
      oneTimePreKey: b.oneTimePreKey ? fromBase64(b.oneTimePreKey) : undefined,
      oneTimePreKeyId: b.oneTimePreKeyId ?? undefined,
      registrationId: b.registrationId,
    };
  }

  async identityKeyOf(userId: string): Promise<Uint8Array | undefined> {
    if (!isUuid(userId)) return this.demo.get(userId);
    const { data } = await client()
      .from("devices")
      .select("identity_key")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);
    const key = data?.[0]?.identity_key as string | undefined;
    return key ? fromBase64(key) : undefined;
  }

  async deviceList(userId: string): Promise<DirectoryDeviceList | undefined> {
    if (!isUuid(userId)) return undefined;
    const { data } = await client().from("devices").select("id").eq("user_id", userId);
    const deviceIds = (data ?? []).map((r) => r.id as string);
    return deviceIds.length ? { userId, deviceIds } : undefined;
  }
}
