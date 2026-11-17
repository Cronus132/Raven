<div align="center">

# 🪶 Raven

**End-to-end encrypted messenger — the server stores and routes only ciphertext.**

Messages and media are encrypted on the client (the real **Signal protocol** for 1:1,
**Sender Keys** for groups), so a breached or compelled server cannot read them.

Web · Desktop (Windows / macOS / Linux) · Android

</div>

---

## Download & install

Grab the latest build from the [**Releases**](https://github.com/Cronus132/Raven/releases) page:

| Platform | File | How to install |
|---|---|---|
| **Web (PWA)** | — | Open **https://cronus132.github.io/Raven/** in Chrome/Edge and click **Install** (or "Add to Home screen"). |
| **Windows** | `Raven-Setup-x.y.z.exe` | Run the installer. (Unsigned build → click *More info → Run anyway* on SmartScreen.) |
| **macOS** | `Raven-x.y.z.dmg` | Open the dmg, drag Raven to Applications. (Unsigned → right-click → Open the first time.) |
| **Linux** | `Raven-x.y.z.AppImage` | `chmod +x` and run. |
| **Android** | `Raven-x.y.z.apk` | Enable "install from unknown sources", then open the APK. (Debug-signed build.) |

All four are the same client — your keys and plaintext never leave your device.

## What works

Real end-to-end encryption, verified end to end against the live backend:

- **1:1 messaging** — X3DH + Double Ratchet via **libsignal** (forward secrecy + post-compromise security)
- **Groups** — Sender Keys (per-sender ratchet distributed over the pairwise channel)
- **Multi-device** — fan-out to every device + sync to your own devices; add a device by signing in
- **Delivery & read receipts**, **typing & presence**, **encrypted media** (images/files)
- **Passkey unlock** (WebAuthn/PRF), **key-change warnings**, **safety numbers**
- **Ciphertext-only backend** — Supabase (Postgres + RLS + Realtime + Storage); the server only ever sees opaque ciphertext and routing metadata

> Security note: the libsignal 1:1 engine uses the maintained libsignal-protocol
> TypeScript port. Groups use the Sender Keys scheme (not RFC 9420 MLS yet).
> This is a personal project; the crypto has **not** had an independent audit.

## Architecture

```
apps/web      Vite + React + TypeScript client (PWA)  ← the single E2E client
apps/desktop  Electron shell loading the web build
apps/mobile   Capacitor (Android) wrapping the web build
supabase/     Postgres migrations (directory, message queue, attachments)
```

Crypto lives in `apps/web/src/lib/crypto/` behind a `CryptoEngine`/`SessionEngine`
boundary; the libsignal engine is in `apps/web/src/lib/crypto/signal/`.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Build from source

Prereqs: Node 20+. Desktop also needs nothing extra; Android needs the Android SDK + JDK 21.

```bash
npm ci

# Web (dev)
npm run dev --workspace apps/web

# Web (production PWA build → apps/web/dist)
BUILD_TARGET=web npm run build --workspace apps/web

# Desktop installer (→ apps/desktop/release)
npm run dist --workspace apps/desktop

# Android APK (needs Android SDK)
npm run sync --workspace apps/mobile
cd apps/mobile/android && ./gradlew assembleDebug
```

CI (GitHub Actions) builds all three on every `v*` tag and publishes a Release;
the web PWA deploys to GitHub Pages on every push to `master`.

## Backend

The client talks to a ciphertext-only Supabase project. The public URL + publishable
key are baked into `apps/web/.env.production` (the anon key is meant to ship in clients;
RLS protects the data). To point it at your own project, change those two values and run
the migrations in `supabase/migrations/`. See [`docs/BACKEND_SETUP.md`](docs/BACKEND_SETUP.md).

## Tests

```bash
cd apps/web && node ../../node_modules/vitest/vitest.mjs run
```

Covers the Double Ratchet, X3DH, the libsignal engine, group messaging, the transport,
and attachment encryption.

---

<div align="center"><sub>The server never sees your messages.</sub></div>
