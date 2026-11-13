import { useEffect } from "react";
import { useChatStore } from "@/store/useChatStore";
import { sendReadReceipt } from "@/lib/chat/liveMessaging";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { DetailsPanel } from "./DetailsPanel";

export function ChatPane() {
  const showDetails = useChatStore((s) => s.showDetails);
  // Subscribe to the active conversation object directly so draft/typing/unread
  // updates re-render this subtree (selecting a store *function* would not).
  const conv = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId));
  const messageCount = useChatStore((s) => s.messages.length);

  // When a live conversation is open, tell the peer we've read their messages.
  useEffect(() => {
    if (!conv?.real || !conv.peerUserId) return;
    const ids = useChatStore.getState().inboundRemoteIds(conv.id);
    if (ids.length) void sendReadReceipt(conv.peerUserId, ids);
  }, [conv?.id, conv?.real, conv?.peerUserId, messageCount]);

  if (!conv) return <EmptyState />;

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-base)]">
        <ChatHeader conv={conv} />
        <MessageList conv={conv} />
        <Composer conv={conv} />
      </div>
      {showDetails && <DetailsPanel conv={conv} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-grain flex flex-1 flex-col items-center justify-center bg-[var(--color-base)] text-center">
      <img src="/raven.svg" alt="" className="h-16 w-16 opacity-80" />
      <h2 className="mt-4 text-xl font-semibold">Raven</h2>
      <p className="mt-1 max-w-xs text-sm text-[var(--color-ink-faint)]">
        Select a conversation to start messaging. Everything you send is encrypted on your device.
      </p>
    </div>
  );
}
