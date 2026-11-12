import { useEffect, useRef } from "react";
import { Plus, Smile, Mic, SendHorizontal, Lock, X } from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";

export function Composer({ conv }: { conv: Conversation }) {
  const setDraft = useChatStore((s) => s.setDraft);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const replyTo = useChatStore((s) => s.replyTo);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const userById = useChatStore((s) => s.userById);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const draft = conv.draft ?? "";

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    taRef.current?.focus();
  }, [conv.id, replyTo]);

  const send = () => {
    if (!draft.trim()) return;
    sendMessage(conv.id, draft);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const hasText = draft.trim().length > 0;

  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-sm)] border-l-2 border-[var(--color-accent)] bg-[var(--color-elevated)] px-3 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-[var(--color-accent)]">
              Replying to {replyTo.senderId === "me" ? "yourself" : userById(replyTo.senderId)?.name}
            </p>
            <p className="truncate text-[12.5px] text-[var(--color-ink-dim)]">{replyTo.body ?? "Attachment"}</p>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--color-ink-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--color-ink-dim)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]" title="Attach">
          <Plus className="h-5 w-5" />
        </button>

        <div className="flex flex-1 items-end gap-1 rounded-[var(--radius-lg)] bg-[var(--color-base)] px-3 py-1.5 ring-1 ring-[var(--color-line)] focus-within:ring-[color-mix(in_oklab,var(--color-accent)_38%,var(--color-line))]">
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(conv.id, e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Write an encrypted message…"
            className="scroll-slim max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] leading-relaxed text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
          />
          <button className="mb-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--color-ink-faint)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]" title="Emoji">
            <Smile className="h-[18px] w-[18px]" />
          </button>
        </div>

        <button
          onClick={send}
          disabled={!hasText}
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all",
            hasText
              ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-strong)]"
              : "bg-[var(--color-hover)] text-[var(--color-ink-faint)]",
          )}
          title={hasText ? "Send" : "Record voice"}
        >
          {hasText ? <SendHorizontal className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[var(--color-ink-faint)]">
        <Lock className="h-3 w-3 text-[var(--color-accent)]" />
        Encrypted on your device before it leaves • Enter to send, Shift+Enter for a new line
      </div>
    </div>
  );
}
