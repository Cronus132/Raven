/**
 * Native biometric unlock (Android / iOS via Capacitor).
 *
 * Like the passkey flow, this does NOT replace the passphrase as the root
 * secret — it's a convenient unlock. The passphrase is stored by
 * capacitor-native-biometric in the platform's hardware-backed secure storage
 * (Android Keystore / iOS Keychain) and released only after a biometric
 * gesture. On the web (and desktop) there's no native layer, so every call
 * no-ops and the UI falls back to passkey / passphrase.
 *
 * The plugin is imported dynamically so the web/desktop bundles never pull in
 * native code at module load.
 */

import { Capacitor } from "@capacitor/core";
import type { NativeBiometricPlugin } from "capacitor-native-biometric";

const SERVER = "app.raven.messenger";

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function plugin(): Promise<NativeBiometricPlugin> {
  const mod = await import("capacitor-native-biometric");
  return mod.NativeBiometric;
}

/** True when the device has biometrics set up and we can use them. */
export async function biometricAvailable(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const res = await (await plugin()).isAvailable({ useFallback: true });
    return !!res.isAvailable;
  } catch {
    return false;
  }
}

/** True when a passphrase has already been stored behind biometrics on this device. */
export async function hasBiometricCredential(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const creds = await (await plugin()).getCredentials({ server: SERVER });
    return !!creds?.password;
  } catch {
    return false;
  }
}

/** Store the passphrase in secure storage, gated by biometrics. */
export async function enrollBiometric(username: string, passphrase: string): Promise<void> {
  if (!isNativePlatform()) throw new Error("Biometrics are only available in the mobile app.");
  await (await plugin()).setCredentials({ username, password: passphrase, server: SERVER });
}

/** Prompt for biometrics, then return the stored passphrase for the normal unlock path. */
export async function biometricUnlock(): Promise<string> {
  if (!isNativePlatform()) throw new Error("Biometrics are only available in the mobile app.");
  const nb = await plugin();
  await nb.verifyIdentity({ reason: "Unlock Raven", title: "Unlock Raven", subtitle: "Confirm your identity" });
  const creds = await nb.getCredentials({ server: SERVER });
  if (!creds?.password) throw new Error("No biometric credential on this device.");
  return creds.password;
}

export async function removeBiometric(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await (await plugin()).deleteCredentials({ server: SERVER });
  } catch {
    /* nothing stored — fine */
  }
}
