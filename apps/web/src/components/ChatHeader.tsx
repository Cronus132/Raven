import { Phone, Video, Search, PanelRight, Lock, ArrowLeft } from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { Avatar } from "./Avatar";
import { cn, formatLastSeen } from "@/lib/utils";
import type { Conversation } from "@/types";

export function ChatHeader({ conv }: { conv: Conversation }) {
  const userById = useChatStore((s) => s.userById);
  const toggleDetails = useChatStore((s) => s.toggleDetails);
  const showDetails = useChatStore((s) => s.showDetails);
  const clearActive = useChatStore((s) => s.clearActive);

  const other = conv.kind === "direct" ? userById(conv.memberIds.find((id) => id !== "me")!) : undefined;
  const typing = conv.typingUserIds.length > 0;

  const subtitle = typing
    ? "typing…"
    : conv.kind === "group"
      ? `${conv.memberIds.length} members`
      : other?.presence === "online"
        ? "online"
        : formatLastSeen(other?.lastSeen);

  return (
    <header className="flex h-16 shrink-0 items-center gap-1.5 border-b border-[var(--color-line)] bg-[var(--color-panel)]/80 px-2 backdrop-blur sm:gap-3 sm:px-4">
      <button
        onClick={clearActive}
        title="Back"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] md:hidden"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <button onClick={toggleDetails} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar
          name={conv.title}
          hue={conv.avatarHue}
          size="md"
          presence={conv.kind === "direct" ? other?.presence : undefined}
          group={conv.kind === "group"}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold">{conv.title}</span>
            <Lock className="h-3 w-3 text-[var(--color-accent)]" />
          </div>
          <p className={cn("truncate text-[12.5px]", typing ? "text-[var(--color-accent)]" : "text-[var(--color-ink-faint)]")}>
            {subtitle}
          </p>
        </div>
      </button>

      <div className="ml-auto flex items-center gap-0.5">
        <HeaderButton icon={Phone} label="Voice call" className="hidden sm:grid" />
        <HeaderButton icon={Video} label="Video call" className="hidden sm:grid" />
        <HeaderButton icon={Search} label="Search in chat" className="hidden sm:grid" />
        <HeaderButton icon={PanelRight} label="Details" active={showDetails} onClick={toggleDetails} />
      </div>
    </header>
  );
}

function HeaderButton({
  icon: Icon,
  label,
  active,
  onClick,
  className,
}: {
  icon: typeof Phone;
  label: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full transition-colors",
        className,
        active
          ? "bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"
          : "text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
