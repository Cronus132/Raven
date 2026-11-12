# Raven — Architecture & Design

A full-featured web messenger where the server stores and routes only ciphertext. Message
bodies and media are end-to-end encrypted on the client using the **Signal protocol** for 1:1
and **MLS** for groups, so a breached or compelled server cannot read them.

This document is the implementation reference. It distills the design into what the code must
honor.

---

## Threat model

The design assumes the server itself is hostile or will be compromised or compelled. Plaintext
exists only on client devices; the server handles ciphertext and the minimum metadata needed to
route it.

**Protected**

- Confidentiality + integrity of message bodies and media, end to end, against the network, the
  server operator, and anyone who later seizes the server.
- Forward secrecy: a key compromise does not expose past messages.
- Post-compromise security: the ratchet heals, so secrecy recovers after a key leak.
- Authenticity: messages are bound to the sender's identity key; tampering is detected.

**Not hidden (the hard limits)**

- Routing metadata: who talks to whom, timing, frequency, approximate ciphertext size. _Mitigate_
  with sealed sender, fixed-size padding buckets, and minimal retention — not eliminate.
- Transport identifiers (IP). Optional Tor/onion routing narrows this; out of scope for v1.
- Endpoint compromise: a malware-infected or unlocked device defeats E2E entirely.

**Key verification.** The server distributes public keys, so it could substitute its own (MITM at
first contact). Defend with out-of-band **safety numbers** (hash of both identity keys) that users
compare, plus **key-change warnings** when a contact's identity key rotates unexpectedly.

---

## Cryptographic design

Use established, audited protocols. **Do not invent primitives.**

- **Identity & prekeys.** Each device generates a long-term identity key pair (Ed25519/X25519) and
  publishes a bundle to the key directory: a signed prekey (rotated periodically) and a batch of
  one-time prekeys. Private keys never leave the device.
- **Session setup (X3DH).** The initiator fetches the recipient's prekey bundle and runs Extended
  Triple Diffie-Hellman into a shared secret. Works asynchronously (recipient can be offline).
- **1:1 (Double Ratchet).** The X3DH secret seeds a Double Ratchet. A symmetric-key ratchet
  advances per message; a DH ratchet advances when a new public key arrives. Forward secrecy +
  post-compromise security. Each message uses a fresh key; AEAD (AES-256-GCM or ChaCha20-Poly1305).
- **Groups (MLS, RFC 9420).** Asynchronous group key agreement that scales to thousands via a
  ratchet tree. Membership changes re-key the group so removed members lose future access.
- **Multi-device.** Each device is a separate cryptographic identity under one account. A message
  fans out to an encrypted copy per recipient device (and per sender device, to sync own history).
- **Libraries.** `libsignal` for X3DH/Double Ratchet; an audited MLS library (e.g. **OpenMLS**) for
  groups. In the browser these run as **WebAssembly** with WebCrypto for primitives.

The `CryptoEngine` interface (`apps/web/src/lib/crypto/engine.ts`) is the boundary: everything
above it is plaintext-in-memory + opaque ciphertext envelopes; nothing above it touches keys.

---

## Components and responsibilities

The server is a dumb relay for ciphertext plus a few trust-minimized services. **No component ever
holds message plaintext or private keys.**

| Component | Responsibility | Sees plaintext? |
|---|---|---|
| Web client | All crypto: keygen, X3DH, ratcheting, encrypt/decrypt, local encrypted store | **Yes (only here)** |
| Auth service | Registration, login, session tokens, device enrollment | No |
| Key directory | Serves public identity keys + prekey bundles; tracks device lists | No (public keys) |
| Messaging / signaling | Accepts encrypted envelopes, routes to devices over WebSocket | No (ciphertext) |
| Delivery queue | Holds encrypted messages for offline devices until fetched, then deletes | No (ciphertext) |
| Media store | Stores client-encrypted blobs; serves by opaque ID | No (ciphertext) |
| Push relay | Content-free wake-ups via APNs/FCM/Web Push | No |

Transport is **TLS 1.3** everywhere (wire-level metadata protection, distinct from the E2E layer).
Routing/delivery nodes hold no long-term secrets, so they scale horizontally and a breach yields
only ciphertext + coarse metadata.

---

## Data model & metadata minimization

Store the least that still lets the system function. Every stored field is a liability under breach
or subpoena.

**Server stores:** accounts (user ID, login credential — Argon2id hash or WebAuthn credential —
and a device list with public keys); prekey bundles (consumed on use); encrypted envelopes (held
only until delivered, then deleted); encrypted media blobs (opaque IDs, expiry).

**Server deliberately does not store:** any plaintext/media/search index; private keys or ratchet
state; social graph beyond what routing forces (use **sealed sender** so the server learns the
recipient, not the authenticated sender); verbose access logs.

**Metadata hardening:** pad ciphertext to fixed-size buckets; deliver via the queue, not direct
links; content-free push; treat IP as exposed unless onion routing is added later.

**Client stores:** full history, keys, and ratchet state in an encrypted local DB (IndexedDB on
web; encrypted SQLite on desktop/Android, keys in the OS keystore). Losing all devices means losing
history by design, unless an optional separately-encrypted backup is offered.

---

## Feature implementation

Everything respects the E2E boundary: anything the server would need to read is computed on the
client and sent encrypted.

- **Groups** — MLS ratchet tree; adds/removes re-key. Server stores only encrypted messages +
  public commit/welcome. Group metadata (name, avatar, roles) is encrypted to the group.
- **Media/files** — client encrypts the blob with a fresh key, uploads ciphertext, sends key + blob
  ID inside the encrypted message. Thumbnails client-side. Size limits + per-blob expiry.
- **Presence/typing** — opt-in, sent as encrypted ephemeral signals to members via the relay.
- **Receipts** — delivery inferred from queue fetch; read receipts are explicit encrypted control
  messages (opt-out).
- **Multi-device sync** — fan-out to all devices; history to a fresh device syncs device-to-device
  over an E2E channel, not from the server. Per-device sessions so revoking one doesn't expose others.
- **Push** — content-free wake; service worker fetches + decrypts, then shows the local notification.
- **Also:** edit/delete (tombstone control messages), replies/reactions (encrypted references to a
  message ID), disappearing messages (client-enforced TTL), search (client-side index over local
  decrypted history).

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Client UI | React (PWA), TypeScript, Tailwind v4 | Mature, installable, offline-capable |
| Crypto (1:1) | libsignal via WASM | Audited X3DH + Double Ratchet |
| Crypto (groups) | OpenMLS (WASM) | Standard MLS, RFC 9420 |
| Primitives | WebCrypto + WASM | Hardware-backed where available |
| Local store | IndexedDB (web) / encrypted SQLite (native) | Encrypted history + key state |
| Realtime | WebSocket (+ Web Push) | Low-latency delivery, offline wake |
| Backend | **Supabase** free tier (Postgres, auth, realtime, storage) | Ciphertext-only; no server to run |
| Scale-up | Cloudflare Durable Objects + R2 | Relay/queue/media past free limits |
| Auth | OAuth2/OIDC + WebAuthn / passkeys | Phishing-resistant login |
| Clients | Shared **Rust core** wrapped by **Tauri v2** | One crypto core → web + desktop + Android |

Because content is E2E encrypted, a managed backend sees only ciphertext + routing metadata — the
same as any server. Choose on free-tier limits, not confidentiality.

---

## Client strategy

One shared core, one UI, three targets:

- **Rust core crate** wraps libsignal + OpenMLS and owns session state, ratchets, and the local
  encrypted store. Compiles to WASM (browser) and native (desktop/Android) — crypto written/audited once.
- **One web UI** (this repo's `apps/web`) is the single interface everywhere.
- **Tauri v2** packages UI + core into desktop apps (Windows/macOS/Linux) and Android; the same UI
  ships as an installable PWA.

Avoid three separate native apps — that triples work, audit surface, and crypto locations.

---

## Roadmap

Build the crypto core first and prove it before adding features. Each phase is shippable.

1. **Foundations** — registration, device keygen, key directory, passkey auth. _(no messaging yet)_
2. **1:1 encrypted messaging** — X3DH, Double Ratchet, WebSocket delivery, offline queue, encrypted
   local history. **This is the core — get it audited.**
3. **Key verification & trust** — safety numbers, key-change warnings, device-list UI.
4. **Media & rich messages** — encrypted upload, thumbnails, replies, reactions, edit/delete.
5. **Groups** — MLS, membership management, group metadata, admin roles.
6. **Multi-device** — per-device sessions, fan-out, device-to-device history sync, revocation.
7. **Presence & polish** — opt-in presence/typing, receipts, disappearing messages, push, search.
8. **Hardening** — sealed sender, padding, reproducible builds, optional encrypted backup, and an
   **independent cryptography + application security review before launch**.

---

## Decisions (settled)

- **Identity:** email + username. Username is the public handle; email enables login + recovery.
- **No own server:** managed free tiers (Supabase). Ciphertext-only, so it costs nothing and leaks
  no content.
- **Groups on MLS from day one.** Skip the Sender Keys interim step.
- **Serverless relay**, no self-hosting (Supabase now, Cloudflare Durable Objects later).
- **Three clients from one core:** web, Android, desktop — one Rust crypto core, one UI.
- **No special compliance** (personal use). Still: audited libraries, passkeys, a reproducible client.
