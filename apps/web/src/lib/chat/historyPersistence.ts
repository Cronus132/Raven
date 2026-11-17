/**
 * Wires the in-memory chat store to the on-device encrypted history store.
 *
 * On unlock we hydrate the store from the last saved snapshot (so a restart
 * restores every chat), then persist a fresh snapshot — debounced — whenever
 * the conversations, roster, or messages change. Mirrors startMessaging /
 * stopMessaging in lifecycle: start on unlock, stop on lock/wipe.
 */

import type { Attachment, Message } from "@/types";
import { useChatStore } from "@/store/useChatStore";
import { clearHistory, deriveHistoryKey, loadHistory, saveHistory, type HistorySnapshot } from "./historyStore";

const SAVE_DEBOUNCE_MS = 500;

let ctx: { userId: string; histKey: Uint8Array } | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Drop the transient blob: object URL — it's revoked on reload and useless on disk. */
function stripVolatile(m: Message): Message {
  if (!m.attachment?.url) return m;
  const { url: _url, ...attachment } = m.attachment as Attachment;
  return { ...m, attachment };
}

/** Build a persistable snapshot of the current store (shared with archive sync). */
export function buildSnapshot(): HistorySnapshot {
  const s = useChatStore.getState();
  return {
    v: 1,
    users: s.users,
    conversations: s.conversations,
    messages: s.messages.map(stripVolatile),
  };
}

function scheduleSave(): void {
  if (!ctx) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const c = ctx;
    if (!c) return;
    void saveHistory(c.userId, c.histKey, buildSnapshot()).catch(() => {});
  }, SAVE_DEBOUNCE_MS);
}

/** Load the saved history into the store, then persist on every change. */
export async function startHistoryPersistence(userId: string, wrappingKey: Uint8Array): Promise<void> {
  stopHistoryPersistence();
  const histKey = deriveHistoryKey(wrappingKey, userId);
  ctx = { userId, histKey };

  const saved = await loadHistory(userId, histKey);
  if (saved) useChatStore.getState().hydrateHistory(saved);

  // Subscribe only after hydrating, so loading never races a save that would
  // overwrite the stored snapshot with the pre-hydrate (empty) state.
  unsubscribe = useChatStore.subscribe((state, prev) => {
    if (
      state.messages !== prev.messages ||
      state.conversations !== prev.conversations ||
      state.users !== prev.users
    ) {
      scheduleSave();
    }
  });
}

export function stopHistoryPersistence(): void {
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

/** Stop persisting and erase this account's on-device history (used on wipe). */
export async function wipeHistory(userId: string): Promise<void> {
  stopHistoryPersistence();
  await clearHistory(userId).catch(() => {});
}
