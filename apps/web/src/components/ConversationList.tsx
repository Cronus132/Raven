import { useMemo } from "react";
import { Search, PenSquare, Pin, BellOff, Image as ImageIcon, FileText, Check, CheckCheck } from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { Avatar } from "./Avatar";
import { TrustBadge } from "./TrustBadge";
import { cn, formatRelative } from "@/lib/utils";
import type { Conversation, Message } from "@/types";

const filters = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "groups", label: "Groups" },
] as const;

export function ConversationList() {
  const { conversations, messages, activeId, filter, search, me } = useChatStore();
  const select = useChatStore((s) => s.select);
  const setFilter = useChatStore((s) => s.setFilter);
  const setSearch = useChatStore((s) => s.setSearch);

  const lastByConv = useMemo(() => {
    const map: Record<string, Message | undefined> = {};
    for (const m of messages) {
      const cur = map[m.conversationId];
      if (!cur || m.createdAt > cur.createdAt) map[m.conversationId] = m;
    }
    return map;
  }, [messages]);

  const list = useMemo(() => {
    let items = [...conversations];
    if (filter === "unread") items = items.filter((c) => c.unreadCount > 0);
    if (filter === "groups") items = items.filter((c) => c.kind === "group");
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((c) => c.title.toLowerCase().includes(q));
    }
    return items.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const am = lastByConv[a.id]?.createdAt ?? 0;
      const bm = lastByConv[b.id]?.createdAt ?? 0;
      return bm - am;
    });
  }, [conversations, filter, search, lastByConv]);

  return (
    <section className="flex w-[340px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-panel)]">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-[17px] font-semibold tracking-tight">Messages</h1>
        <button
          className="grid h-9 w-9 place-items-center rounded-full text-[var(--color-ink-dim)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          title="New message"
        >
          <PenSquare className="h-[18px] w-[18px]" />
        </button>
      </header>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-base)] px-3 py-2 ring-1 ring-[var(--color-line)] focus-within:ring-[color-mix(in_oklab,var(--color-accent)_40%,var(--color-line))]">
          <Search className="h-4 w-4 text-[var(--color-ink-faint)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-1.5 px-4 pb-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-full px-3 py-1 text-[13px] font-medium transition-colors",
              filter === f.id
                ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
                : "bg-[var(--color-hover)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="scroll-slim flex-1 overflow-y-auto px-2 pb-3">
        {list.length === 0 && (
          <p className="px-4 pt-8 text-center text-sm text-[var(--color-ink-faint)]">No conversations</p>
        )}
        {list.map((c) => (
          <ConversationRow
            key={c.id}
            conv={c}
            last={lastByConv[c.id]}
            active={c.id === activeId}
            isMine={lastByConv[c.id]?.senderId === me.id}
            onSelect={() => select(c.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ConversationRow({
  conv,
  last,
  active,
  isMine,
  onSelect,
}: {
  conv: Conversation;
  last?: Message;
  active: boolean;
  isMine: boolean;
  onSelect: () => void;
}) {
  const userById = useChatStore((s) => s.userById);
  const other = conv.kind === "direct" ? userById(conv.memberIds.find((id) => id !== "me")!) : undefined;
  const typing = conv.typingUserIds.length > 0;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2.5 text-left transition-colors",
        active ? "bg-[var(--color-active)]" : "hover:bg-[var(--color-hover)]",
      )}
    >
      <Avatar
        name={conv.title}
        hue={conv.avatarHue}
        size="lg"
        presence={conv.kind === "direct" ? other?.presence : undefined}
        group={conv.kind === "group"}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px] font-medium text-[var(--color-ink)]">{conv.title}</span>
          <TrustBadge trust={conv.trust} />
          {conv.muted && <BellOff className="h-3 w-3 text-[var(--color-ink-faint)]" />}
          <span className="ml-auto shrink-0 text-[11px] text-[var(--color-ink-faint)]">
            {last ? formatRelative(last.createdAt) : ""}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          <Preview conv={conv} last={last} isMine={isMine} typing={typing} />
          <div className="ml-auto flex items-center gap-1.5">
            {conv.pinned && <Pin className="h-3 w-3 text-[var(--color-ink-faint)]" />}
            {conv.unreadCount > 0 && (
              <span className="grid min-w-[18px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[11px] font-semibold text-[var(--color-accent-ink)]">
                {conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function Preview({
  conv,
  last,
  isMine,
  typing,
}: {
  conv: Conversation;
  last?: Message;
  isMine: boolean;
  typing: boolean;
}) {
  const userById = useChatStore((s) => s.userById);

  if (typing) {
    return <span className="truncate text-[13px] text-[var(--color-accent)]">typing…</span>;
  }
  if (!last) return <span className="truncate text-[13px] text-[var(--color-ink-faint)]">No messages yet</span>;

  const senderName =
    conv.kind === "group" && !isMine ? `${userById(last.senderId)?.name.split(" ")[0] ?? ""}: ` : "";

  return (
    <span className="flex min-w-0 items-center gap-1 text-[13px] text-[var(--color-ink-dim)]">
      {isMine && <ReceiptTick status={last.status} />}
      {last.kind === "image" && <ImageIcon className="h-3.5 w-3.5 shrink-0" />}
      {last.kind === "file" && <FileText className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">
        {senderName}
        {last.kind === "image" ? last.body || "Photo" : last.kind === "file" ? last.attachment?.name : last.body}
      </span>
    </span>
  );
}

function ReceiptTick({ status }: { status: Message["status"] }) {
  if (status === "read")
    return <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 shrink-0" />;
  return <Check className="h-3.5 w-3.5 shrink-0" />;
}
