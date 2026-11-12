/**
 * Passkey unlock (WebAuthn + PRF extension).
 *
 * A passkey here does NOT replace the passphrase as the root secret — losing a
 * passkey never locks you out, because the passphrase still works. Instead it is
 * a convenient, phishing-resistant way to *unlock the local key store* with the
 * device authenticator (Windows Hello / Touch ID / a security key).
 *
 * How it stays end-to-end safe:
 *  - WebAuthn's PRF extension lets a credential derive a stable 32-byte secret
 *    from a fixed salt. That secret never leaves the authenticator and is gated
 *    by user verification (biometric / PIN).
 *  - We wrap (AES-256-GCM) the passphrase under a key derived from that PRF
 *    secret and store only the sealed blob locally. Unlock = authenticator
 *    gesture -> PRF secret -> unwrap passphrase -> normal unlock path.
 *  - Nothing passkey-related is ever sent to the server.
 */

import type { AccountMeta } from "./keystore";
import {
  deletePasskeyEnvelope,
  loadPasskeyEnvelope,
  savePasskeyEnvelope,
  type PasskeyEnvelope,
} from "./keystore";
import { aeadOpen, aeadSeal, fromBase64, randomBytes, sha256, toBase64, utf8 } from "./primitives";

// Fixed per-app PRF salt: the same input always yields the same per-credential secret.
const PRF_SALT = utf8("raven-keystore-prf-v1");

// --- minimal typings for the PRF extension (not yet in the DOM lib) ----------
type PrfExtensionInput = { prf?: { eval?: { first: BufferSource } } };
type PrfExtensionOutput = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

function rpId(): string {
  return window.location.hostname;
}

/** True when this browser/device can do platform passkeys at all. */
export async function passkeysAvailable(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Whether a passkey has been enrolled on this device. */
export async function hasPasskey(): Promise<boolean> {
  return (await loadPasskeyEnvelope()) !== undefined;
}

export class PasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyError";
  }
}

function prfSecretToKey(secret: ArrayBuffer): Uint8Array {
  // Domain-separate and normalize to a 32-byte AES key.
  return sha256(new Uint8Array(secret));
}

/** Read the PRF result from an assertion/attestation, or undefined if unsupported. */
function readPrf(cred: PublicKeyCredential): ArrayBuffer | undefined {
  const ext = cred.getClientExtensionResults() as PrfExtensionOutput;
  return ext.prf?.results?.first;
}

/**
 * Enroll a passkey on this device, sealing `passphrase` under the credential's
 * PRF secret. Requires the passphrase (available while the app is unlocked).
 */
export async function enrollPasskey(meta: AccountMeta, passphrase: string): Promise<void> {
  if (!(await passkeysAvailable())) throw new PasskeyError("Passkeys aren't available on this device.");

  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { id: rpId(), name: "Raven" },
      user: { id: utf8(meta.userId), name: meta.email, displayName: meta.username },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60_000,
      extensions: { prf: { eval: { first: PRF_SALT } } } as PrfExtensionInput as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!created) throw new PasskeyError("Passkey creation was cancelled.");
  const credentialId = new Uint8Array(created.rawId);

  // Some authenticators return the PRF secret at creation; many only at
  // assertion. Use the create-time result if present, otherwise do one get().
  let secret = readPrf(created);
  if (!secret) secret = await assertPrf(credentialId);
  if (!secret) {
    throw new PasskeyError("This device's authenticator doesn't support the PRF extension needed for passkey unlock.");
  }

  const key = prfSecretToKey(secret);
  const box = await aeadSeal(key, utf8(passphrase), utf8(meta.userId));
  const envelope: PasskeyEnvelope = {
    version: 1,
    credentialId: toBase64(credentialId),
    salt: toBase64(PRF_SALT),
    iv: toBase64(box.iv),
    ciphertext: toBase64(box.ciphertext),
    aad: meta.userId,
  };
  await savePasskeyEnvelope(envelope);
}

/** Run a PRF assertion for a known credential and return the 32-byte secret. */
async function assertPrf(credentialId: Uint8Array, salt: Uint8Array = PRF_SALT): Promise<ArrayBuffer | undefined> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: rpId(),
      allowCredentials: [{ type: "public-key", id: credentialId }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } } as PrfExtensionInput as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return undefined;
  return readPrf(assertion);
}

/**
 * Unlock via passkey: run the authenticator, derive the PRF secret, and unwrap
 * the stored passphrase. Returns the passphrase so the caller runs the normal
 * unlock path.
 */
export async function recoverPassphraseWithPasskey(): Promise<string> {
  const env = await loadPasskeyEnvelope();
  if (!env) throw new PasskeyError("No passkey is set up on this device.");

  const secret = await assertPrf(fromBase64(env.credentialId), fromBase64(env.salt));
  if (!secret) throw new PasskeyError("Couldn't get the passkey secret. Use your passphrase.");

  const key = prfSecretToKey(secret);
  try {
    const plaintext = await aeadOpen(
      key,
      { iv: fromBase64(env.iv), ciphertext: fromBase64(env.ciphertext) },
      utf8(env.aad),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new PasskeyError("Passkey didn't match this identity. Use your passphrase.");
  }
}

/** Remove the passkey from this device (the passphrase still unlocks). */
export async function removePasskey(): Promise<void> {
  await deletePasskeyEnvelope();
}
