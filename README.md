<div align="center">

# 🪶 Raven

**End-to-end encrypted messenger — the server stores and routes only ciphertext.**

Message bodies and media are encrypted on the client (Signal for 1:1, MLS for groups),
so a breached or compelled server cannot read them.

</div>

---

## Status

Early scaffold. The **web client UI** is built and runnable: a sectioned, dark, reactive
interface (navigation rail → conversation list → chat → details panel). Crypto and backend
are stubbed behind clean interfaces and land next per the [roadmap](#roadmap).

| Area | State |
|---|---|
| Web client UI (React PWA) | ✅ Built — sectioned layout, dark "graphite + emerald" theme |
| Reactive state + demo data | ✅ Working (send, reactions, replies, receipts, typing) |
| `CryptoEngine` interface | ✅ Defined (`src/lib/crypto/engine.ts`) |
| Signal (X3DH + Double Ratchet) | ⏳ Next — via libsignal (WASM / Rust core) |
| MLS groups (RFC 9420) | ⏳ Planned — OpenMLS |
| Backend (Supabase relay) | ⏳ Planned — ciphertext-only |
| Desktop / Android (Tauri v2) | ⏳ Planned — shared Rust core |

## Quick start

```bash
npm install
npm run dev          # web client at http://localhost:5173
```

> First install: this repo runs native install scripts for `esbuild` and `@tailwindcss/oxide`,
> pre-approved in `package.json` → `allowScripts`.

Other scripts:

```bash
npm run build        # typecheck + production build
npm run preview      # preview the production build
```

## Design principles

1. **The server is a dumb relay for ciphertext.** No component ever holds plaintext or private keys.
2. **Don't invent primitives.** Build on audited protocols: libsignal (1:1), MLS/OpenMLS (groups).
3. **Minimize metadata.** Store the least that still lets delivery work; sealed sender, padding, short retention.
4. **One crypto core, three clients.** A shared Rust core compiles to WASM (web) and native (desktop/Android via Tauri v2).
5. **Trust is verifiable.** Safety numbers + key-change warnings defend first-contact MITM.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full threat model, cryptographic design,
data model, and decisions.

## Repository layout

```
raven/
├─ apps/
│  └─ web/                 # React + TypeScript + Tailwind v4 PWA (the single shared UI)
│     └─ src/
│        ├─ components/    # Rail, ConversationList, ChatPane, MessageList, Composer, DetailsPanel …
│        ├─ store/         # Zustand reactive store
│        ├─ lib/crypto/    # CryptoEngine boundary (UI ↔ E2E crypto)
│        ├─ data/          # demo seed (replaced by the local encrypted store)
│        └─ types/
├─ packages/              # shared packages (crypto core bindings, protocol types) — to come
└─ docs/
   └─ ARCHITECTURE.md
```

## Theme

Dark, warm-neutral graphite base with an **emerald** accent (reads as "secure / encrypted",
and suits the Raven name). Deliberately no blue / purple / red. Tokens live in
`apps/web/src/styles/index.css`.

## License

MIT
