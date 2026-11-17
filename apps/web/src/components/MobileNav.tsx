import { useState } from "react";
import { MessageSquare, Users, Phone, Archive, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore, type NavView } from "@/store/useChatStore";
import { ProfileSheet } from "./ProfileSheet";

const items: { id: NavView; icon: LucideIcon; label: string }[] = [
  { id: "chats", icon: MessageSquare, label: "Chats" },
  { id: "groups", icon: Users, label: "Groups" },
  { id: "calls", icon: Phone, label: "Calls" },
  { id: "archive", icon: Archive, label: "Archived" },
];

/** Bottom tab bar for narrow (phone) layouts; the Rail is hidden there. */
export function MobileNav() {
  const nav = useChatStore((s) => s.nav);
  const setNav = useChatStore((s) => s.setNav);
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <>
      <nav className="flex shrink-0 items-stretch border-t border-[var(--color-line)] bg-[var(--color-rail)] pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map((it) => (
          <Tab key={it.id} icon={it.icon} label={it.label} active={nav === it.id} onClick={() => setNav(it.id)} />
        ))}
        <Tab icon={Settings} label="Settings" active={profileOpen} onClick={() => setProfileOpen(true)} />
      </nav>
      {profileOpen && <ProfileSheet onClose={() => setProfileOpen(false)} />}
    </>
  );
}

function Tab({
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
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
        active ? "text-[var(--color-accent)]" : "text-[var(--color-ink-faint)]",
      )}
    >
      <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.9} />
      {label}
    </button>
  );
}
