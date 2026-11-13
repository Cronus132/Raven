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
import { fromBase64, toBase64, utf8 } from "./primitives";
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

// ---- serialization ----------------------------------------------------------
// Sessions are serialized to persist across reloads (sealed at rest by the
// caller); messages are serialized to an opaque base64 blob for the wire.

const b64 = toBase64;
const unb64 = fromBase64;

function headerToJson(h: RatchetHeader) {
  return { dh: b64(h.dh), pn: h.pn, n: h.n };
}
function headerFromJson(o: { dh: string; pn: number; n: number }): RatchetHeader {
  return { dh: unb64(o.dh), pn: o.pn, n: o.n };
}

function preambleToJson(p: X3DHPreamble) {
  return {
    identityKey: b64(p.identityKey),
    ephemeralKey: b64(p.ephemeralKey),
    signedPreKeyId: p.signedPreKeyId,
    oneTimePreKeyId: p.oneTimePreKeyId,
  };
}
function preambleFromJson(o: {
  identityKey: string;
  ephemeralKey: string;
  signedPreKeyId: number;
  oneTimePreKeyId?: number;
}): X3DHPreamble {
  return {
    identityKey: unb64(o.identityKey),
    ephemeralKey: unb64(o.ephemeralKey),
    signedPreKeyId: o.signedPreKeyId,
    oneTimePreKeyId: o.oneTimePreKeyId,
  };
}

/** Serialize a message to an opaque base64 string for the transport. */
export function serializeMessage(msg: DirectMessage): string {
  const json = JSON.stringify({
    preamble: msg.preamble ? preambleToJson(msg.preamble) : undefined,
    header: headerToJson(msg.header),
    body: b64(msg.body),
  });
  return b64(utf8(json));
}

export function deserializeMessage(blob: string): DirectMessage {
  const o = JSON.parse(new TextDecoder().decode(unb64(blob)));
  return {
    preamble: o.preamble ? preambleFromJson(o.preamble) : undefined,
    header: headerFromJson(o.header),
    body: unb64(o.body),
  };
}

/** Serialize a live session (including ratchet state) for sealed-at-rest storage. */
export function serializeSession(session: DirectSession): string {
  const s = session.state;
  return JSON.stringify({
    established: session.established,
    preamble: session.preamble ? preambleToJson(session.preamble) : undefined,
    state: {
      rootKey: b64(s.rootKey),
      dhSelf: { priv: b64(s.dhSelf.priv), pub: b64(s.dhSelf.pub) },
      dhRemote: s.dhRemote ? b64(s.dhRemote) : null,
      sendChain: s.sendChain ? b64(s.sendChain) : null,
      recvChain: s.recvChain ? b64(s.recvChain) : null,
      sendN: s.sendN,
      recvN: s.recvN,
      prevN: s.prevN,
      skipped: Array.from(s.skipped.entries()).map(([k, v]) => [k, b64(v)]),
      ad: b64(s.ad),
    },
  });
}

export function deserializeSession(blob: string): DirectSession {
  const o = JSON.parse(blob);
  const st = o.state;
  const state: RatchetState = {
    rootKey: unb64(st.rootKey),
    dhSelf: { priv: unb64(st.dhSelf.priv), pub: unb64(st.dhSelf.pub) },
    dhRemote: st.dhRemote ? unb64(st.dhRemote) : null,
    sendChain: st.sendChain ? unb64(st.sendChain) : null,
    recvChain: st.recvChain ? unb64(st.recvChain) : null,
    sendN: st.sendN,
    recvN: st.recvN,
    prevN: st.prevN,
    skipped: new Map((st.skipped as [string, string][]).map(([k, v]) => [k, unb64(v)])),
    ad: unb64(st.ad),
  };
  return { state, established: o.established, preamble: o.preamble ? preambleFromJson(o.preamble) : undefined };
}
