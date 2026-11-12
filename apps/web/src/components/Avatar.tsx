import { avatarGradient, cn, initials } from "@/lib/utils";
import type { Presence } from "@/types";

const sizes = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-20 w-20 text-2xl",
};

const dot: Record<Presence, string> = {
  online: "bg-[var(--color-online)]",
  away: "bg-[var(--color-away)]",
  offline: "bg-[var(--color-offline)]",
};

export function Avatar({
  name,
  hue,
  size = "md",
  presence,
  group,
  className,
}: {
  name: string;
  hue: number;
  size?: keyof typeof sizes;
  presence?: Presence;
  group?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "no-drag grid place-items-center rounded-full font-semibold text-white/90 ring-1 ring-white/5",
          sizes[size],
        )}
        style={{ background: avatarGradient(hue) }}
      >
        {group ? <GroupGlyph /> : initials(name)}
      </div>
      {presence && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[var(--color-panel)]",
            size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3",
            dot[presence],
          )}
        />
      )}
    </div>
  );
}

function GroupGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 opacity-90" fill="currentColor">
      <circle cx="9" cy="9" r="3.2" />
      <circle cx="16" cy="10.5" r="2.6" />
      <path d="M3.5 18c.6-2.8 2.9-4.4 5.5-4.4s4.9 1.6 5.5 4.4z" />
      <path d="M14.5 18c.3-1.6 1.1-2.9 2.3-3.6 2 .1 3.6 1.5 4 3.6z" />
    </svg>
  );
}
