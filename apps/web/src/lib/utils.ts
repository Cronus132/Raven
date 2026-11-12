import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Deterministic emerald-leaning gradient avatar from a hue seed. */
export function avatarGradient(hue: number): string {
  const a = `hsl(${hue} 55% 42%)`;
  const b = `hsl(${(hue + 28) % 360} 48% 26%)`;
  return `linear-gradient(140deg, ${a}, ${b})`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "now";
  if (diff < hour) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatDayDivider(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function formatLastSeen(ts?: number): string {
  if (!ts) return "offline";
  return `last seen ${formatRelative(ts)} ago`;
}

export function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "off";
  const day = 86400;
  const hour = 3600;
  if (seconds >= day) return `${Math.round(seconds / day)}d`;
  if (seconds >= hour) return `${Math.round(seconds / hour)}h`;
  return `${Math.round(seconds / 60)}m`;
}
