import { useState } from "react";
import { Check, CheckCheck, Clock, Image as ImageIcon, FileText, Download, Reply, SmilePlus } from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { cn, formatBytes, formatTime } from "@/lib/utils";
import type { Message } from "@/types";

const QUICK = ["❤️", "🔥", "👍", "😂", "🙌", "🔒"];

export function MessageBubble({
  message,
  showSender,
  grouped,
}: {
  message: Message;
  showSender: boolean;
  grouped: boolean;
}) {
  const userById = useChatStore((s) => s.userById);
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const messagesFor = useChatStore((s) => s.messagesFor);
  const [hover, setHover] = useState(false);
  const [picker, setPicker] = useState(false);

  const mine = message.senderId === "me";
  const sender = userById(message.senderId);
  const replyTo = message.replyToId
    ? messagesFor(message.conversationId).find((m) => m.id === message.replyToId)
    : undefined;

  return (
    <div
      className={cn("flex w-full gap-2 px-1", mine ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-3")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPicker(false);
      }}
    >
      <div className={cn("flex max-w-[76%] flex-col", mine ? "items-end" : "items-start")}>
        {showSender && !mine && (
          <span className="mb-1 ml-1 text-[12px] font-medium" style={{ color: `hsl(${sender?.avatarHue ?? 150} 55% 62%)` }}>
            {sender?.name}
          </span>
        )}

        <div className={cn("flex items-end gap-1.5", mine && "flex-row-reverse")}>
          <div
            className={cn(
              "animate-pop relative rounded-[var(--radius-lg)] px-3.5 py-2 text-[14.5px] leading-relaxed shadow-[var(--shadow-panel)]",
              mine
                ? "rounded-br-md bg-[var(--color-accent-deep)] text-white"
                : "rounded-bl-md bg-[var(--color-elevated)] text-[var(--color-ink)]",
            )}
          >
            {replyTo && (
              <div
                className={cn(
                  "mb-1.5 rounded-[var(--radius-xs)] border-l-2 px-2 py-1 text-[12.5px]",
                  mine ? "border-white/60 bg-black/15 text-white/80" : "border-[var(--color-accent)] bg-black/20 text-[var(--color-ink-dim)]",
                )}
              >
                <span className="block font-medium opacity-90">
                  {replyTo.senderId === "me" ? "You" : userById(replyTo.senderId)?.name}
                </span>
                <span className="line-clamp-1 opacity-80">{replyTo.body ?? "Attachment"}</span>
              </div>
            )}

            {message.kind === "image" && <ImageBlock message={message} />}
            {message.kind === "file" && <FileBlock message={message} mine={mine} />}

            {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}

            <span
              className={cn(
                "float-right ml-2 mt-1 flex select-none items-center gap-1 text-[10.5px]",
                mine ? "text-white/70" : "text-[var(--color-ink-faint)]",
              )}
            >
              {message.editedAt && <span className="italic">edited</span>}
              {formatTime(message.createdAt)}
              {mine && <Receipt status={message.status} />}
            </span>
          </div>

          {/* hover actions */}
          <div className={cn("flex items-center gap-0.5 transition-opacity", hover ? "opacity-100" : "opacity-0")}>
            <button
              onClick={() => setPicker((p) => !p)}
              className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-ink-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
              title="React"
            >
              <SmilePlus className="h-4 w-4" />
            </button>
            <button
              onClick={() => setReplyTo(message)}
              className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-ink-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
              title="Reply"
            >
              <Reply className="h-4 w-4" />
            </button>
          </div>
        </div>

        {picker && (
          <div className="animate-pop mt-1 flex gap-1 rounded-full bg-[var(--color-elevated)] p-1 ring-1 ring-[var(--color-line)] shadow-[var(--shadow-pop)]">
            {QUICK.map((e) => (
              <button
                key={e}
                onClick={() => {
                  toggleReaction(message.id, e);
                  setPicker(false);
                }}
                className="grid h-8 w-8 place-items-center rounded-full text-lg transition hover:scale-110 hover:bg-[var(--color-hover)]"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {message.reactions && message.reactions.length > 0 && (
          <div className={cn("mt-1 flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")}>
            {message.reactions.map((r) => {
              const mineReact = r.userIds.includes("me");
              return (
                <button
                  key={r.emoji}
                  onClick={() => toggleReaction(message.id, r.emoji)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] ring-1 transition",
                    mineReact
                      ? "bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] ring-[var(--color-accent)] text-[var(--color-ink)]"
                      : "bg-[var(--color-hover)] ring-transparent text-[var(--color-ink-dim)]",
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="tabular-nums">{r.userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Receipt({ status }: { status: Message["status"] }) {
  if (status === "sending") return <Clock className="h-3 w-3 opacity-80" />;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-white" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 opacity-80" />;
  if (status === "failed") return <span className="text-[var(--color-warn)]">!</span>;
  return <Check className="h-3.5 w-3.5 opacity-80" />;
}

function ImageBlock({ message }: { message: Message }) {
  const a = message.attachment;
  return (
    <div className="mb-1 overflow-hidden rounded-[var(--radius-sm)]">
      <div
        className="grid aspect-[3/2] w-[min(340px,60vw)] place-items-center"
        style={{ background: `linear-gradient(135deg, ${a?.previewColor ?? "#13302a"}, #0d1714)` }}
      >
        <ImageIcon className="h-8 w-8 text-white/30" />
      </div>
    </div>
  );
}

function FileBlock({ message, mine }: { message: Message; mine: boolean }) {
  const a = message.attachment;
  return (
    <div
      className={cn(
        "mb-1 flex items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2",
        mine ? "bg-black/15" : "bg-black/25",
      )}
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-xs)] bg-[var(--color-accent-deep)]/40">
        <FileText className="h-5 w-5 text-[var(--color-accent)]" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium">{a?.name}</p>
        <p className="text-[11px] opacity-70">{formatBytes(a?.size)}</p>
      </div>
      <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-white/10">
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}
