import { useState } from "react";
import { X, Lock, Mail, Smartphone, Fingerprint, ShieldCheck, Copy, Check, Trash2 } from "lucide-react";
import { useIdentityStore } from "@/store/useIdentityStore";
import { Avatar } from "./Avatar";
import { cn } from "@/lib/utils";

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const meta = useIdentityStore((s) => s.meta);
  const lock = useIdentityStore((s) => s.lock);
  const wipe = useIdentityStore((s) => s.wipe);
  const fingerprint = useIdentityStore((s) => s.fingerprint)();
  const [copied, setCopied] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  if (!meta) return null;

  const copyFingerprint = async () => {
    if (!fingerprint) return;
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-pop w-full max-w-[380px] rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="text-[15px] font-semibold">Your account</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-center px-5 pb-4 pt-6">
          <Avatar name={meta.username} hue={152} size="xl" presence="online" />
          <h3 className="mt-3 text-[18px] font-semibold">{meta.username}</h3>
          <p className="text-[13px] text-[var(--color-ink-faint)]">@{meta.username}</p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
            <ShieldCheck className="h-3 w-3" /> Identity active
          </span>
        </div>

        <div className="space-y-0.5 px-4 pb-2">
          <InfoRow icon={Mail} label="Email" value={meta.email} />
          <InfoRow icon={Smartphone} label="Device" value={meta.deviceId} mono />
          <div className="flex items-start gap-3 rounded-[var(--radius-sm)] px-2 py-2">
            <Fingerprint className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--color-ink-dim)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-[var(--color-ink-faint)]">Identity key fingerprint</p>
              <p className="mt-0.5 break-all font-mono text-[12.5px] text-[var(--color-ink)]">{fingerprint}</p>
            </div>
            <button
              onClick={copyFingerprint}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
              title="Copy"
            >
              {copied ? <Check className="h-4 w-4 text-[var(--color-accent)]" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2 border-t border-[var(--color-line)] p-4">
          <button
            onClick={() => {
              lock();
              onClose();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-hover)] py-2.5 text-[13.5px] font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-active)]"
          >
            <Lock className="h-4 w-4" /> Lock app
          </button>

          {!confirmWipe ? (
            <button
              onClick={() => setConfirmWipe(true)}
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] py-2 text-[12.5px] text-[var(--color-ink-faint)] transition hover:text-[var(--color-warn)]"
            >
              <Trash2 className="h-3.5 w-3.5" /> Erase identity from this device
            </button>
          ) : (
            <div className="rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] p-3 ring-1 ring-[color-mix(in_oklab,var(--color-warn)_24%,transparent)]">
              <p className="text-[12px] text-[var(--color-ink-dim)]">
                Permanently delete this device's keys and local history? This cannot be undone.
              </p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => setConfirmWipe(false)} className="flex-1 rounded-[var(--radius-sm)] bg-[var(--color-hover)] py-1.5 text-[12.5px]">
                  Cancel
                </button>
                <button
                  onClick={() => void wipe()}
                  className="flex-1 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--color-warn)_20%,transparent)] py-1.5 text-[12.5px] font-medium text-[var(--color-warn)]"
                >
                  Erase
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, mono }: { icon: typeof Mail; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2">
      <Icon className="h-[18px] w-[18px] shrink-0 text-[var(--color-ink-dim)]" />
      <span className="text-[12px] text-[var(--color-ink-faint)]">{label}</span>
      <span className={cn("ml-auto truncate text-[12.5px] text-[var(--color-ink)]", mono && "font-mono")}>{value}</span>
    </div>
  );
}
