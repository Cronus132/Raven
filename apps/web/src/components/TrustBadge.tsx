import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrustLevel } from "@/types";

const config: Record<
  TrustLevel,
  { label: string; icon: typeof ShieldCheck; className: string; tone: string }
> = {
  verified: {
    label: "Verified",
    icon: ShieldCheck,
    className: "text-[var(--color-accent)]",
    tone: "bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]",
  },
  unverified: {
    label: "Not verified",
    icon: ShieldQuestion,
    className: "text-[var(--color-ink-faint)]",
    tone: "bg-[var(--color-hover)] text-[var(--color-ink-dim)]",
  },
  changed: {
    label: "Key changed",
    icon: ShieldAlert,
    className: "text-[var(--color-warn)]",
    tone: "bg-[color-mix(in_oklab,var(--color-warn)_16%,transparent)] text-[var(--color-warn)]",
  },
};

export function TrustBadge({ trust, withLabel = false }: { trust: TrustLevel; withLabel?: boolean }) {
  const c = config[trust];
  const Icon = c.icon;
  if (!withLabel) return <Icon className={cn("h-3.5 w-3.5", c.className)} strokeWidth={2.2} />;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        c.tone,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.4} />
      {c.label}
    </span>
  );
}
