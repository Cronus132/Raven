import { useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, KeyRound, ShieldCheck, Fingerprint, Server } from "lucide-react";
import { useIdentityStore } from "@/store/useIdentityStore";
import { cn } from "@/lib/utils";
import { AuthShell, Field, inputClass } from "./AuthShell";
import { SignIn } from "./SignIn";

export function Onboarding() {
  const register = useIdentityStore((s) => s.register);
  const busy = useIdentityStore((s) => s.busy);
  const error = useIdentityStore((s) => s.error);
  const [mode, setMode] = useState<"register" | "signin">("register");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const strength = useMemo(() => passStrength(pass), [pass]);

  // All hooks must run before this conditional return (Rules of Hooks).
  if (mode === "signin") return <SignIn onBack={() => setMode("register")} />;

  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username);
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const passValid = pass.length >= 10;
  const match = pass.length > 0 && pass === confirm;
  const canSubmit = usernameValid && emailValid && passValid && match && !busy;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    void register({ username, email, passphrase: pass });
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h2 className="text-[17px] font-semibold">Create your identity</h2>
          <p className="mt-1 text-[12.5px] text-[var(--color-ink-dim)]">
            Your device generates a long-term key pair and prekeys. We publish only the public keys.
          </p>
        </div>

        <Field label="Username" hint="public handle">
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="mehrose"
            autoComplete="username"
            autoFocus
          />
          {username.length > 0 && !usernameValid && (
            <p className="mt-1 text-[11px] text-[var(--color-warn)]">3–20 chars: lowercase letters, numbers, underscore.</p>
          )}
        </Field>

        <Field label="Email" hint="login & recovery">
          <input
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
          />
          {email.length > 0 && !emailValid && (
            <p className="mt-1 text-[11px] text-[var(--color-warn)]">Enter a valid email address.</p>
          )}
        </Field>

        <Field label="Passphrase" hint="encrypts your keys">
          <div className="relative">
            <input
              className={cn(inputClass, "pr-10")}
              type={show ? "text" : "password"}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="At least 10 characters"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {pass.length > 0 && <StrengthMeter strength={strength} />}
        </Field>

        <Field label="Confirm passphrase">
          <input
            className={inputClass}
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat passphrase"
            autoComplete="new-password"
          />
          {confirm.length > 0 && !match && <p className="mt-1 text-[11px] text-[var(--color-warn)]">Passphrases don't match.</p>}
        </Field>

        <div className="rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--color-ink-dim)] ring-1 ring-[color-mix(in_oklab,var(--color-warn)_24%,transparent)]">
          Your passphrase wraps your private keys on this device. It is never sent anywhere and
          <span className="font-medium text-[var(--color-ink)]"> cannot be recovered</span> — if you lose it, you lose access.
        </div>

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
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Generating keys…
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4" /> Generate identity &amp; keys
            </>
          )}
        </button>

        <div className="grid grid-cols-3 gap-2 pt-1">
          <Assurance icon={Fingerprint} label="Keys on device" />
          <Assurance icon={Server} label="Server gets ciphertext" />
          <Assurance icon={ShieldCheck} label="X3DH + ratchet" />
        </div>

        <button
          type="button"
          onClick={() => setMode("signin")}
          className="mx-auto flex items-center justify-center text-[12.5px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
        >
          Already have an account? Sign in on this device
        </button>
      </form>
    </AuthShell>
  );
}

function Assurance({ icon: Icon, label }: { icon: typeof ShieldCheck; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-base)] px-1 py-2 text-center ring-1 ring-[var(--color-line)]">
      <Icon className="h-4 w-4 text-[var(--color-accent)]" />
      <span className="text-[10px] leading-tight text-[var(--color-ink-faint)]">{label}</span>
    </div>
  );
}

type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string };

function passStrength(p: string): Strength {
  let score = 0;
  if (p.length >= 10) score++;
  if (p.length >= 16) score++;
  if (/[^a-zA-Z0-9]/.test(p)) score++;
  if (/[0-9]/.test(p) && /[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  const clamped = Math.min(score, 4) as Strength["score"];
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  return { score: clamped, label: labels[clamped] };
}

function StrengthMeter({ strength }: { strength: Strength }) {
  const colors = ["#e0a93b", "#e0a93b", "#c9b04a", "#7bc47f", "#34d399"];
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="flex h-1 flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-full flex-1 rounded-full transition-colors"
            style={{ background: i < strength.score ? colors[strength.score] : "var(--color-active)" }}
          />
        ))}
      </div>
      <span className="text-[10.5px] text-[var(--color-ink-faint)]">{strength.label}</span>
    </div>
  );
}
