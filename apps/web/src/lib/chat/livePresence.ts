/**
 * Presence + typing over Supabase Realtime (ephemeral signals, not E2E content).
 *
 * A shared presence channel tracks which accounts are online and carries typing
 * broadcasts. NOTE: these are routing/metadata signals the relay can see (who is
 * online, who is typing to whom) — acceptable for now; metadata minimization
 * (sealed sender) is a later hardening step.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/backend/supabase";
import { useChatStore } from "@/store/useChatStore";

let channel: RealtimeChannel | null = null;
let selfId = "";

interface TypingPayload {
  from: string;
  to: string;
  typing: boolean;
}

export function startPresence(selfUserId: string): void {
  if (!supabase) return;
  stopPresence();
  selfId = selfUserId;

  const ch = supabase.channel("raven-presence", {
    config: { presence: { key: selfUserId }, broadcast: { self: false } },
  });

  ch.on("presence", { event: "sync" }, () => {
    useChatStore.getState().setOnlineUsers(Object.keys(ch.presenceState()));
  });
  ch.on("broadcast", { event: "typing" }, ({ payload }) => {
    const p = payload as TypingPayload;
    if (p.to === selfId) useChatStore.getState().setPeerTyping(p.from, p.typing);
  });
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") void ch.track({ at: Date.now() });
  });
  channel = ch;
}

export function stopPresence(): void {
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  useChatStore.getState().setOnlineUsers([]);
}

export function sendTyping(peerUserId: string, typing: boolean): void {
  if (!channel) return;
  void channel.send({ type: "broadcast", event: "typing", payload: { from: selfId, to: peerUserId, typing } });
}
