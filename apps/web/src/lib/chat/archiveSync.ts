/**
 * Durable cross-device history archive (Phase 2).
 *
 * Keeps one encrypted row per user in Supabase `message_archive` (migration
 * 0004): the whole chat history, sealed with the portable archive key derived
 * from the passphrase. On unlock we PULL that row and hydrate — this is how a
 * brand-new or reinstalled device recovers history it was never individually
 * sent. We then PUSH (debounced) whenever history changes, so the archive stays
 * current. The server only ever sees ciphertext; RLS restricts the row to its
 * owner.
 *
 * Degrades gracefully: with no backend, offline, or before migration 0004 is
 * applied, it simply no-ops — local persistence still keeps each device's own
 * history across restarts.
 */

import { isSupabaseConfigured, supabase } from "@/lib/backend/supabase";
import { useChatStore } from "@/store/useChatStore";
import { deriveArchiveKey, openSnapshot, sealSnapshot } from "./historyStore";
import { buildSnapshot } from "./historyPersistence";

const PUSH_DEBOUNCE_MS = 4000;

let ctx: { userId: string; key: Uint8Array } | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set once the archive table clearly isn't there yet (migration not applied). */
let unavailable = false;

interface PgError {
  code?: string;
  message?: string;
}

/** The archive table hasn't been created (migration 0004 not applied) — stop trying. */
function isMissingTable(err: PgError | null): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || msg.includes("message_archive");
}

async function pull(): Promise<void> {
  if (!ctx || !supabase) return;
  const { data, error } = await supabase
    .from("message_archive")
    .select("iv,ciphertext")
    .eq("owner_user", ctx.userId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) unavailable = true;
    return;
  }
  if (!data) return;
  const snap = await openSnapshot(ctx.userId, ctx.key, { v: 1, iv: data.iv, ciphertext: data.ciphertext });
  if (snap) useChatStore.getState().hydrateHistory(snap);
}

async function push(): Promise<void> {
  if (!ctx || unavailable || !supabase) return;
  const rec = await sealSnapshot(ctx.userId, ctx.key, buildSnapshot());
  const { error } = await supabase
    .from("message_archive")
    .upsert({ owner_user: ctx.userId, iv: rec.iv, ciphertext: rec.ciphertext, updated_at: new Date().toISOString() });
  if (error && isMissingTable(error)) unavailable = true;
}

function schedulePush(): void {
  if (!ctx || unavailable) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void push().catch(() => {}), PUSH_DEBOUNCE_MS);
}

/** Begin syncing: pull the archive to restore history, then push on every change. */
export async function startArchiveSync(userId: string, passphrase: string): Promise<void> {
  stopArchiveSync();
  if (!(isSupabaseConfigured && supabase)) return;
  unavailable = false;
  ctx = { userId, key: deriveArchiveKey(passphrase, userId) };

  await pull().catch(() => {});

  unsubscribe = useChatStore.subscribe((state, prev) => {
    if (
      state.messages !== prev.messages ||
      state.conversations !== prev.conversations ||
      state.users !== prev.users
    ) {
      schedulePush();
    }
  });
}

export function stopArchiveSync(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  ctx = null;
}
