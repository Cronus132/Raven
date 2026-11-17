import { useEffect, useState } from "react";
import { X, ShieldCheck, Clock, Bell, BellOff, Fingerprint, Images, FileText, Trash2, QrCode } from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { useIdentityStore } from "@/store/useIdentityStore";
import { Avatar } from "./Avatar";
import { TrustBadge } from "./TrustBadge";
import { cn, formatDuration } from "@/lib/utils";
import type { Conversation } from "@/types";

export function DetailsPanel({ conv }: { conv: Conversation }) {
  const toggleDetails = useChatStore((s) => s.toggleDetails);
  const userById = useChatStore((s) => s.userById);
  const other = conv.kind === "direct" ? userById(conv.memberIds.find((id) => id !== "me")!) : undefined;

  return (
    <aside className="scroll-slim flex w-full shrink-0 flex-col overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-panel)] max-md:fixed max-md:inset-0 max-md:z-40 md:w-[320px]">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-line)] px-4">
        <h2 className="text-[15px] font-semibold">Details</h2>
        <button
          onClick={toggleDetails}
          className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col items-center px-4 pb-4 pt-6">
        <Avatar name={conv.title} hue={conv.avatarHue} size="xl" group={conv.kind === "group"} />
        <h3 className="mt-3 text-[18px] font-semibold">{conv.title}</h3>
        <p className="text-[13px] text-[var(--color-ink-faint)]">
          {conv.kind === "group" ? conv.description : other?.handle}
        </p>
        <div className="mt-3">
          <TrustBadge trust={conv.trust} withLabel />
        </div>
      </div>

      {conv.trust === "changed" && (
        <div className="mx-4 mb-4 rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] p-3 text-[12.5px] text-[var(--color-ink-dim)] ring-1 ring-[color-mix(in_oklab,var(--color-warn)_30%,transparent)]">
          <p className="font-medium text-[var(--color-warn)]">Safety number changed</p>
          <p className="mt-1">
            {conv.title.split(" ")[0]}'s identity key changed — likely a new device. Verify again before trusting this
            chat.
          </p>
        </div>
      )}

      <Section title="Encryption">
        <Row icon={ShieldCheck} label="End-to-end encrypted" value={conv.kind === "group" ? "MLS · RFC 9420" : "Signal · Double Ratchet"} accent />
        {conv.kind === "direct" && other && <SafetyNumberRow remoteUserId={other.id} />}
      </Section>

      <Section title="Settings">
        <ToggleRow icon={conv.muted ? BellOff : Bell} label="Mute notifications" on={!!conv.muted} />
        <Row
          icon={Clock}
          label="Disappearing messages"
          value={conv.disappearingSeconds ? formatDuration(conv.disappearingSeconds) : "Off"}
        />
      </Section>

      {conv.kind === "group" && (
        <Section title={`Members · ${conv.memberIds.length}`}>
          {conv.memberIds.map((id) => {
            const u = userById(id);
            if (!u) return null;
            const isAdmin = conv.adminIds?.includes(id);
            return (
              <div key={id} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--color-hover)]">
                <Avatar name={u.name} hue={u.avatarHue} size="sm" presence={u.presence} />
                <span className="text-[13.5px]">{id === "me" ? "You" : u.name}</span>
                {isAdmin && (
                  <span className="ml-auto rounded-full bg-[var(--color-hover)] px-2 py-0.5 text-[10.5px] text-[var(--color-ink-dim)]">
                    admin
                  </span>
                )}
              </div>
            );
          })}
        </Section>
      )}

      <Section title="Shared media">
        <div className="grid grid-cols-3 gap-1.5">
          {["#13302a", "#1a2b24", "#16241f", "#1d3029", "#122722", "#1b2d26"].map((c, i) => (
            <div key={i} className="grid aspect-square place-items-center rounded-[var(--radius-xs)]" style={{ background: `linear-gradient(135deg, ${c}, #0d1714)` }}>
              <Images className="h-4 w-4 text-white/25" />
            </div>
          ))}
        </div>
        <button className="mt-2 flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-[13px] text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)]">
          <FileText className="h-4 w-4" /> 12 files
        </button>
      </Section>

      <div className="mt-auto p-4">
        <button className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] py-2.5 text-[13.5px] font-medium text-[var(--color-warn)] transition hover:bg-[color-mix(in_oklab,var(--color-warn)_18%,transparent)]">
          <Trash2 className="h-4 w-4" /> {conv.kind === "group" ? "Leave group" : "Delete chat"}
        </button>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--color-line)] px-4 py-4">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{title}</h4>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2">
      <Icon className={cn("h-[18px] w-[18px]", accent ? "text-[var(--color-accent)]" : "text-[var(--color-ink-dim)]")} />
      <span className="text-[13.5px] text-[var(--color-ink)]">{label}</span>
      {value && <span className="ml-auto text-[12.5px] text-[var(--color-ink-faint)]">{value}</span>}
    </div>
  );
}

function ToggleRow({ icon: Icon, label, on }: { icon: typeof Bell; label: string; on: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2">
      <Icon className="h-[18px] w-[18px] text-[var(--color-ink-dim)]" />
      <span className="text-[13.5px]">{label}</span>
      <span
        className={cn(
          "ml-auto flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
          on ? "bg-[var(--color-accent)]" : "bg-[var(--color-active)]",
        )}
      >
        <span className={cn("h-4 w-4 rounded-full bg-white transition-transform", on && "translate-x-4")} />
      </span>
    </div>
  );
}

function SafetyNumberRow({ remoteUserId }: { remoteUserId: string }) {
  const safetyNumberWith = useIdentityStore((s) => s.safetyNumberWith);
  const [safety, setSafety] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void safetyNumberWith(remoteUserId).then((v) => active && setSafety(v));
    return () => {
      active = false;
    };
  }, [remoteUserId, safetyNumberWith]);

  return (
    <div className="rounded-[var(--radius-sm)] px-2 py-2">
      <div className="flex items-center gap-3">
        <Fingerprint className="h-[18px] w-[18px] text-[var(--color-ink-dim)]" />
        <span className="text-[13.5px]">Safety number</span>
        <button className="ml-auto grid h-7 w-7 place-items-center rounded-full text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]" title="Show QR">
          <QrCode className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 rounded-[var(--radius-xs)] bg-[var(--color-base)] p-2 font-mono text-[11px] leading-relaxed tracking-wide text-[var(--color-ink-dim)] ring-1 ring-[var(--color-line)]">
        {safety ?? "Computing…"}
      </p>
      <p className="mt-1.5 px-0.5 text-[11px] text-[var(--color-ink-faint)]">
        Compare these digits in person or over a trusted channel to confirm no one is intercepting.
      </p>
    </div>
  );
}
