/**
 * Key directory — the service that stores and serves *public* identity keys and
 * prekey bundles and tracks device lists. It never sees private keys or plaintext.
 *
 * This file defines the interface plus a LocalKeyDirectory used while the
 * Supabase-backed directory is wired (Phase 1 backend). The local one also
 * seeds deterministic identity keys for the demo contacts so safety numbers and
 * key-change detection render against real key material.
 */

import { ed25519 } from "@noble/curves/ed25519";
import type { PreKeyBundle } from "./engine";
import type { DeviceSecret } from "./identity";
import { sha256, utf8 } from "./primitives";

export interface DirectoryDeviceList {
  userId: string;
  deviceIds: string[];
}

export interface KeyDirectory {
  publish(bundle: PreKeyBundle): Promise<void>;
  /**
   * Publish a device's full public key set (identity + signed prekey + every
   * one-time prekey). Backends that can store a prekey pool implement this; the
   * store prefers it over `publish`, which only carries a single bundle.
   */
  publishKeys?(secret: DeviceSecret, userId: string): Promise<void>;
  /** Fetch a device's bundle, consuming a one-time prekey server-side on real backends. */
  fetchBundle(userId: string, deviceId?: string): Promise<PreKeyBundle | undefined>;
  /** The stable identity key for a user's primary device (for safety numbers). */
  identityKeyOf(userId: string): Promise<Uint8Array | undefined>;
  deviceList(userId: string): Promise<DirectoryDeviceList | undefined>;
  /** Resolve a public @username to an account (for starting a conversation). */
  findUserByUsername?(username: string): Promise<{ userId: string; username: string } | undefined>;
  /** The public @username for an account id (for labeling inbound messages). */
  usernameOf?(userId: string): Promise<string | undefined>;
}

/** Deterministic demo identity key so safety numbers are stable per contact. */
export function demoIdentityKey(userId: string): Uint8Array {
  const seed = sha256(utf8(`raven-demo-identity:${userId}`));
  return ed25519.getPublicKey(seed);
}

export class LocalKeyDirectory implements KeyDirectory {
  private bundles = new Map<string, PreKeyBundle>(); // key: `${userId}/${deviceId}`
  private identities = new Map<string, Uint8Array>();

  constructor(demoUserIds: string[] = []) {
    for (const id of demoUserIds) this.identities.set(id, demoIdentityKey(id));
  }

  async publish(bundle: PreKeyBundle): Promise<void> {
    this.bundles.set(`${bundle.userId}/${bundle.deviceId}`, bundle);
    this.identities.set(bundle.userId, bundle.identityKey);
  }

  async fetchBundle(userId: string, deviceId?: string): Promise<PreKeyBundle | undefined> {
    if (deviceId) return this.bundles.get(`${userId}/${deviceId}`);
    for (const [k, v] of this.bundles) if (k.startsWith(`${userId}/`)) return v;
    return undefined;
  }

  async identityKeyOf(userId: string): Promise<Uint8Array | undefined> {
    return this.identities.get(userId);
  }

  async deviceList(userId: string): Promise<DirectoryDeviceList | undefined> {
    const deviceIds: string[] = [];
    for (const k of this.bundles.keys()) {
      const [u, d] = k.split("/");
      if (u === userId) deviceIds.push(d);
    }
    return deviceIds.length ? { userId, deviceIds } : undefined;
  }
}
