import { useState } from "react";
import { Eye, EyeOff, Loader2, LogIn, ArrowLeft } from "lucide-react";
import { useIdentityStore } from "@/store/useIdentityStore";
import { cn } from "@/lib/utils";
import { AuthShell, Field, inputClass } from "./AuthShell";

export function SignIn({ onBack }: { onBack: () => void }) {
  const signIn = useIdentityStore((s) => s.signIn);
  const busy = useIdentityStore((s) => s.busy);
  const error = useIdentityStore((s) => s.error);

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const canSubmit = emailValid && pass.length >= 10 && !busy;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    void signIn({ email, passphrase: pass });
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h2 className="text-[17px] font-semibold">Add this device</h2>
          <p className="mt-1 text-[12.5px] text-[var(--color-ink-dim)]">
            Sign in to an existing account. This device generates its own keys — your passphrase never leaves it.
          </p>
        </div>

        <Field label="Email">
          <input
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            autoFocus
          />
        </Field>

        <Field label="Passphrase" hint="your account passphrase">
          <div className="relative">
            <input
              className={cn(inputClass, "pr-10")}
              type={show ? "text" : "password"}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="Your passphrase"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        {error && <p className="text-[12.5px] text-[var(--color-warn)]">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] py-2.5 text-[14px] font-semibold transition",
            canSubmit
              ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-strong)]"
              : "cursor-not-allowed bg-[var(--color-hover)] text-[var(--color-ink-faint)]",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {busy ? "Signing in…" : "Sign in & add device"}
        </button>

        <button
          type="button"
          onClick={onBack}
          className="mx-auto flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> New here? Create an account
        </button>
      </form>
    </AuthShell>
  );
}
