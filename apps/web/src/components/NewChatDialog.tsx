import { useState } from "react";
import { X, Loader2, AtSign, MessageSquarePlus } from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { lookupUser } from "@/lib/chat/liveMessaging";

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const startLiveConversation = useChatStore((s) => s.startLiveConversation);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    if (!h || busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = await lookupUser(h);
      if (!found) {
        setError("No one found with that username.");
        setBusy(false);
        return;
      }
      startLiveConversation({ peerUserId: found.userId, username: found.username });
      onClose();
    } catch {
      setError("Couldn't search right now — messaging may still be connecting.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-pop w-full max-w-[380px] rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-panel)] shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <MessageSquarePlus className="h-4 w-4 text-[var(--color-accent)]" /> New conversation
          </h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-ink-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 p-4">
          <p className="text-[12.5px] text-[var(--color-ink-dim)]">
            Enter a Raven username. We fetch their public keys and start an end-to-end encrypted chat.
          </p>
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-base)] px-3 py-2 ring-1 ring-[var(--color-line)] focus-within:ring-[color-mix(in_oklab,var(--color-accent)_40%,var(--color-line))]">
            <AtSign className="h-4 w-4 text-[var(--color-ink-faint)]" />
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="username"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full bg-transparent text-[14px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
            />
          </div>

          {error && <p className="text-[12px] text-[var(--color-warn)]">{error}</p>}

          <button
            type="submit"
            disabled={busy || handle.trim().length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-[var(--color-accent-ink)] transition hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
            {busy ? "Looking up…" : "Start chat"}
          </button>
        </form>
      </div>
    </div>
  );
}
