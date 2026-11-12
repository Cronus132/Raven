import { useState } from "react";
import { MessageSquare, Users, Phone, Archive, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { useChatStore } from "@/store/useChatStore";
import { ProfileSheet } from "./ProfileSheet";

const items: { id: string; icon: LucideIcon; label: string; badge?: number }[] = [
  { id: "chats", icon: MessageSquare, label: "Chats" },
  { id: "groups", icon: Users, label: "Groups" },
  { id: "calls", icon: Phone, label: "Calls" },
  { id: "archive", icon: Archive, label: "Archived" },
];

export function Rail() {
  const me = useChatStore((s) => s.me);
  const [active, setActive] = useState("chats");
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-rail)] py-4">
      <div className="mb-3 grid h-11 w-11 place-items-center">
        <img src="/raven.svg" alt="Raven" className="h-9 w-9 no-drag" />
      </div>

      <div className="flex flex-1 flex-col items-center gap-1">
        {items.map((it) => (
          <RailButton
            key={it.id}
            icon={it.icon}
            label={it.label}
            active={active === it.id}
            onClick={() => setActive(it.id)}
          />
        ))}
      </div>

      <RailButton icon={Settings} label="Settings" active={active === "settings"} onClick={() => setActive("settings")} />
      <button
        onClick={() => setProfileOpen(true)}
        className="mt-2 rounded-full outline-none ring-[var(--color-accent)] transition hover:opacity-90 focus-visible:ring-2"
        title={`${me.name} — account`}
      >
        <Avatar name={me.name} hue={me.avatarHue} size="md" presence={me.presence} />
      </button>

      {profileOpen && <ProfileSheet onClose={() => setProfileOpen(false)} />}
    </nav>
  );
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "group relative grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] transition-colors",
        active
          ? "bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"
          : "text-[var(--color-ink-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-x-[18px] -translate-y-1/2 rounded-full bg-[var(--color-accent)]" />
      )}
      <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.9} />
    </button>
  );
}
