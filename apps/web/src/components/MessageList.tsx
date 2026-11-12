import { useEffect, useMemo, useRef } from "react";
import { Lock } from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { MessageBubble } from "./MessageBubble";
import { Avatar } from "./Avatar";
import { formatDayDivider } from "@/lib/utils";
import type { Conversation, Message } from "@/types";

export function MessageList({ conv }: { conv: Conversation }) {
  const userById = useChatStore((s) => s.userById);
  // Subscribe to the raw messages array so new sends re-render this list.
  const allMessages = useChatStore((s) => s.messages);
  const messages = useMemo(
    () => allMessages.filter((m) => m.conversationId === conv.id).sort((a, b) => a.createdAt - b.createdAt),
    [allMessages, conv.id],
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conv.id]);

  let lastDay = "";
  let lastSender = "";

  return (
    <div className="scroll-slim bg-grain flex-1 overflow-y-auto px-4 py-3">
      <EncryptionNotice title={conv.title} />

      {messages.map((m, i) => {
        const day = formatDayDivider(m.createdAt);
        const dayChanged = day !== lastDay;
        if (dayChanged) lastDay = day;

        const prev = messages[i - 1];
        const grouped =
          !dayChanged &&
          !!prev &&
          prev.senderId === m.senderId &&
          m.createdAt - prev.createdAt < 4 * 60_000;
        const showSender = conv.kind === "group" && (dayChanged || lastSender !== m.senderId || !grouped);
        lastSender = m.senderId;

        return (
          <div key={m.id}>
            {dayChanged && <DayDivider label={day} />}
            <MessageBubble message={m} showSender={showSender} grouped={grouped} />
          </div>
        );
      })}

      {conv.typingUserIds.length > 0 && (
        <TypingRow name={userById(conv.typingUserIds[0])?.name ?? ""} hue={userById(conv.typingUserIds[0])?.avatarHue ?? 150} />
      )}

      <div ref={bottomRef} className="h-2" />
    </div>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center justify-center">
      <span className="rounded-full bg-[var(--color-elevated)] px-3 py-1 text-[11px] font-medium text-[var(--color-ink-faint)] ring-1 ring-[var(--color-line)]">
        {label}
      </span>
    </div>
  );
}

function EncryptionNotice({ title }: { title: string }) {
  return (
    <div className="mx-auto mb-2 mt-2 flex max-w-md items-start gap-2 rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] px-3.5 py-2.5 text-center ring-1 ring-[color-mix(in_oklab,var(--color-accent)_22%,transparent)]">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
      <p className="text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
        Messages to <span className="font-medium text-[var(--color-ink)]">{title}</span> are end-to-end encrypted.
        Raven's servers only ever see ciphertext — not even we can read them.
      </p>
    </div>
  );
}

function TypingRow({ name, hue }: { name: string; hue: number }) {
  return (
    <div className="mt-3 flex items-end gap-2 px-1">
      <Avatar name={name} hue={hue} size="sm" />
      <div className="flex items-center gap-1 rounded-[var(--radius-lg)] rounded-bl-md bg-[var(--color-elevated)] px-3.5 py-3">
        {[0, 0.15, 0.3].map((d) => (
          <span
            key={d}
            className="h-1.5 w-1.5 rounded-full bg-[var(--color-ink-faint)]"
            style={{ animation: `typing-bounce 1.2s ${d}s infinite ease-in-out` }}
          />
        ))}
      </div>
    </div>
  );
}

export type { Message };
