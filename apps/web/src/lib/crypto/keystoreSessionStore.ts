/**
 * Keystore-backed session store: persists Double Ratchet sessions across reloads,
 * sealed at rest (AES-256-GCM) under a key derived once from the passphrase at
 * unlock. Chain keys are sensitive, so they are never stored in the clear.
 */

import type { SessionRecord, SessionStore } from "./messaging";
import { deserializeSession, serializeSession } from "./session";
import { deleteSessionRecord, loadSessionRecord, saveSessionRecord } from "./keystore";
import { aeadOpen, aeadSeal, fromBase64, toBase64, utf8 } from "./primitives";

interface Sealed {
  iv: string;
  ct: string;
}

export class KeystoreSessionStore implements SessionStore {
  // `key` is a 32-byte wrapping key derived once (scrypt) at unlock and kept in memory.
  constructor(private readonly key: Uint8Array) {}

  async save(rec: SessionRecord): Promise<void> {
    const payload = JSON.stringify({ peerDevice: rec.peerDevice, session: serializeSession(rec.session) });
    const box = await aeadSeal(this.key, utf8(payload), utf8(rec.peerUserId));
    const sealed: Sealed = { iv: toBase64(box.iv), ct: toBase64(box.ciphertext) };
    await saveSessionRecord(rec.peerUserId, JSON.stringify(sealed));
  }

  async load(peerUserId: string): Promise<SessionRecord | undefined> {
    const blob = await loadSessionRecord(peerUserId);
    if (!blob) return undefined;
    const sealed = JSON.parse(blob) as Sealed;
    const pt = await aeadOpen(
      this.key,
      { iv: fromBase64(sealed.iv), ciphertext: fromBase64(sealed.ct) },
      utf8(peerUserId),
    );
    const inner = JSON.parse(new TextDecoder().decode(pt)) as { peerDevice: string; session: string };
    return { peerUserId, peerDevice: inner.peerDevice, session: deserializeSession(inner.session) };
  }

  async remove(peerUserId: string): Promise<void> {
    await deleteSessionRecord(peerUserId);
  }
}
