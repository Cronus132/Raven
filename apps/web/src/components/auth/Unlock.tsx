import { useState } from "react";
import { Eye, EyeOff, Loader2, Lock, LogOut } from "lucide-react";
import { useIdentityStore } from "@/store/useIdentityStore";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { AuthShell, inputClass } from "./AuthShell";

export function Unlock() {
  const unlock = useIdentityStore((s) => s.unlock);
  const wipe = useIdentityStore((s) => s.wipe);
  const meta = useIdentityStore((s) => s.meta);
  const busy = useIdentityStore((s) => s.busy);
  const error = useIdentityStore((s) => s.error);
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pass.length === 0 || busy) return;
    void unlock(pass);
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-col items-center text-center">
          <Avatar name={meta?.username ?? "?"} hue={152} size="xl" />
          <h2 className="mt-3 text-[17px] font-semibold">Welcome back{meta ? `, ${meta.username}` : ""}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-dim)]">
            <Lock className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            Your keys are encrypted on this device
          </p>
        </div>

        <div className="relative">
          <input
            className={cn(inputClass, "pr-10")}
            type={show ? "text" : "password"}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Enter your passphrase"
            autoComplete="current-password"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error && <p className="text-[12.5px] text-[var(--color-warn)]">{error}</p>}

        <button
          type="submit"
          disabled={pass.length === 0 || busy}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] py-2.5 text-[14px] font-semibold transition",
            pass.length > 0 && !busy
              ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-strong)]"
              : "cursor-not-allowed bg-[var(--color-hover)] text-[var(--color-ink-faint)]",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          {busy ? "Unlocking…" : "Unlock"}
        </button>

        <div className="border-t border-[var(--color-line)] pt-3 text-center">
          {!confirmWipe ? (
            <button
              type="button"
              onClick={() => setConfirmWipe(true)}
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
            >
              <LogOut className="h-3.5 w-3.5" /> Forgot passphrase? Start over
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-[12px] text-[var(--color-warn)]">
                This permanently erases this device's keys and history. It cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  className="flex-1 rounded-[var(--radius-sm)] bg-[var(--color-hover)] py-1.5 text-[12.5px] text-[var(--color-ink)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void wipe()}
                  className="flex-1 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--color-warn)_18%,transparent)] py-1.5 text-[12.5px] font-medium text-[var(--color-warn)]"
                >
                  Erase &amp; start over
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
