export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-grain grid min-h-screen w-screen place-items-center overflow-y-auto bg-[var(--color-base)] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}raven.svg`} alt="Raven" className="h-12 w-12 no-drag" />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Raven</h1>
          <p className="mt-1 text-[13px] text-[var(--color-ink-faint)]">End-to-end encrypted. Keys never leave this device.</p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] p-6 shadow-[var(--shadow-pop)]">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-[var(--color-ink)]">{label}</span>
        {hint && <span className="text-[11px] text-[var(--color-ink-faint)]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-[var(--radius-md)] bg-[var(--color-base)] px-3.5 py-2.5 text-[14px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] ring-1 ring-[var(--color-line)] transition focus:outline-none focus:ring-[color-mix(in_oklab,var(--color-accent)_45%,var(--color-line))]";
