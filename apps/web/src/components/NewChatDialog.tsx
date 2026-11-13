import { useState } from "react";
import { X, Loader2, AtSign, MessageSquarePlus, Users, UserPlus } from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { createGroupLive, lookupUser } from "@/lib/chat/liveMessaging";
import { cn } from "@/lib/utils";

type Member = { userId: string; username: string };

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const startLiveConversation = useChatStore((s) => s.startLiveConversation);
  const startGroupConversation = useChatStore((s) => s.startGroupConversation);

  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [handle, setHandle] = useState("");
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalize = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

  const startDm = async () => {
    const h = normalize(handle);
    if (!h) return;
    setBusy(true);
    setError(null);
    try {
      const found = await lookupUser(h);
      if (!found) {
        setError("No one found with that username.");
        return;
      }
      startLiveConversation({ peerUserId: found.userId, username: found.username });
      onClose();
    } catch {
      setError("Couldn't search — messaging may still be connecting.");
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    const h = normalize(handle);
    if (!h) return;
    if (members.some((m) => m.username === h)) {
      setHandle("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await lookupUser(h);
      if (!found) {
        setError("No one found with that username.");
        return;
      }
      setMembers((m) => [...m, { userId: found.userId, username: found.username }]);
      setHandle("");
    } catch {
      setError("Couldn't search — messaging may still be connecting.");
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim() || members.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const groupId = await createGroupLive(
        groupName.trim(),
        members.map((m) => m.userId),
      );
      startGroupConversation({ groupId, name: groupName.trim(), members });
      onClose();
    } catch {
      setError("Couldn't create the group — messaging may still be connecting.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === "dm") void startDm();
    else void addMember();
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

        <div className="flex gap-1.5 px-4 pt-3">
          {(["dm", "group"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition-colors",
                mode === m
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
                  : "bg-[var(--color-hover)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
              )}
            >
              {m === "dm" ? <AtSign className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
              {m === "dm" ? "Direct" : "Group"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3 p-4">
          {mode === "group" && (
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="w-full rounded-[var(--radius-md)] bg-[var(--color-base)] px-3 py-2 text-[14px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] ring-1 ring-[var(--color-line)] focus:outline-none focus:ring-[color-mix(in_oklab,var(--color-accent)_40%,var(--color-line))]"
            />
          )}

          {mode === "group" && members.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <span
                  key={m.userId}
                  className="flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] px-2 py-0.5 text-[12px] text-[var(--color-accent)]"
                >
                  @{m.username}
                  <button type="button" onClick={() => setMembers((xs) => xs.filter((x) => x.userId !== m.userId))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <p className="text-[12.5px] text-[var(--color-ink-dim)]">
            {mode === "dm"
              ? "Enter a Raven username to start an end-to-end encrypted chat."
              : "Add members by username, then create the encrypted group."}
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
            {mode === "group" && (
              <button type="submit" disabled={busy} className="text-[var(--color-accent)] disabled:opacity-50" title="Add member">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              </button>
            )}
          </div>

          {error && <p className="text-[12px] text-[var(--color-warn)]">{error}</p>}

          {mode === "dm" ? (
            <button
              type="submit"
              disabled={busy || handle.trim().length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-[var(--color-accent-ink)] transition hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
              {busy ? "Looking up…" : "Start chat"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void createGroup()}
              disabled={busy || groupName.trim().length === 0 || members.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] py-2.5 text-[14px] font-semibold text-[var(--color-accent-ink)] transition hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Create group ({members.length})
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
