/**
 * 1:1 session: X3DH setup + Double Ratchet messaging.
 *
 * This is the piece the chat UI/transport will use (via the CryptoEngine
 * boundary): establish a session from a fetched prekey bundle, then encrypt and
 * decrypt opaque messages. The initiator attaches the X3DH preamble to its
 * outbound messages until it receives a reply (Signal's PreKey message), after
 * which plain ratchet messages flow both ways.
 */

import type { DeviceSecret } from "./identity";
import {
  initRatchetInitiator,
  initRatchetResponder,
  ratchetDecrypt,
  ratchetEncrypt,
  type RatchetHeader,
  type RatchetState,
} from "./doubleRatchet";
import { x3dhInitiator, x3dhResponder, type ResolvedPreKeyBundle, type X3DHPreamble } from "./x3dh";

/** An opaque, encrypted 1:1 message ready for the relay. */
export interface DirectMessage {
  preamble?: X3DHPreamble; // present until the session is confirmed both ways
  header: RatchetHeader;
  body: Uint8Array; // iv + AES-256-GCM ciphertext
}

export interface DirectSession {
  state: RatchetState;
  preamble?: X3DHPreamble; // initiator attaches this to outbound messages until a reply arrives
  established: boolean; // true once a message from the peer has been decrypted
}

/** Alice: establish a session toward Bob from his fetched prekey bundle. */
export function startInitiatorSession(alice: DeviceSecret, bob: ResolvedPreKeyBundle): DirectSession {
  const x = x3dhInitiator(alice, bob);
  return {
    state: initRatchetInitiator(x.sharedSecret, x.ad, x.remoteRatchetKey),
    preamble: x.preamble,
    established: false,
  };
}

/** Bob: establish a session from the X3DH preamble on Alice's first message. */
export function startResponderSession(bob: DeviceSecret, preamble: X3DHPreamble): DirectSession {
  const x = x3dhResponder(bob, preamble);
  return {
    state: initRatchetResponder(x.sharedSecret, x.ad, x.selfRatchetKey),
    established: true,
  };
}

export async function encryptMessage(session: DirectSession, plaintext: Uint8Array): Promise<DirectMessage> {
  const { header, body } = await ratchetEncrypt(session.state, plaintext);
  const msg: DirectMessage = { header, body };
  if (session.preamble && !session.established) msg.preamble = session.preamble;
  return msg;
}

export async function decryptMessage(session: DirectSession, msg: DirectMessage): Promise<Uint8Array> {
  const plaintext = await ratchetDecrypt(session.state, msg.header, msg.body);
  session.established = true; // peer replied: stop attaching the preamble
  return plaintext;
}
