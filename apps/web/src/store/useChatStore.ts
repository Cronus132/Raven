import { create } from "zustand";
import type { Conversation, Message, MessageStatus, User } from "@/types";
import { CONVERSATIONS, MESSAGES, USERS, ME } from "@/data/seed";

type Filter = "all" | "unread" | "groups";

interface ChatState {
  me: User;
  users: Record<string, User>;
  conversations: Conversation[];
  messages: Message[];

  activeId: string | null;
  filter: Filter;
  search: string;
  showDetails: boolean;
  replyTo: Message | null;

  // selectors
  conversationById: (id: string) => Conversation | undefined;
  messagesFor: (id: string) => Message[];
  userById: (id: string) => User | undefined;

  // actions
  select: (id: string) => void;
  setFilter: (f: Filter) => void;
  setSearch: (q: string) => void;
  toggleDetails: () => void;
  setDraft: (id: string, draft: string) => void;
  setReplyTo: (m: Message | null) => void;
  sendMessage: (id: string, body: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  markRead: (id: string) => void;

  // live (real E2E) messaging
  appendOutgoing: (conversationId: string, body: string) => string;
  setMessageStatus: (messageId: string, status: MessageStatus) => void;
  startLiveConversation: (peer: { peerUserId: string; username: string }) => string;
  receiveLiveMessage: (msg: { peerUserId: string; username: string; text: string }) => void;
}

function hueFromId(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Ensure a user + direct conversation exist for a real peer; returns the conversation id. */
function ensureLivePeer(
  s: ChatState,
  peerUserId: string,
  username: string,
): { users: Record<string, User>; conversations: Conversation[]; convId: string } {
  const convId = `d_${peerUserId}`;
  const hue = hueFromId(peerUserId);
  const users =
    s.users[peerUserId] != null
      ? s.users
      : {
          ...s.users,
          [peerUserId]: {
            id: peerUserId,
            name: username,
            handle: `@${username}`,
            avatarHue: hue,
            presence: "online" as const,
          },
        };
  const conversations = s.conversations.some((c) => c.id === convId)
    ? s.conversations
    : [
        {
          id: convId,
          kind: "direct" as const,
          title: username,
          memberIds: ["me", peerUserId],
          avatarHue: hue,
          trust: "unverified" as const,
          unreadCount: 0,
          lastReadAt: 0,
          typingUserIds: [],
          real: true,
          peerUserId,
        },
        ...s.conversations,
      ];
  return { users, conversations, convId };
}

let seq = 1000;
const nextId = (p: string) => `${p}_${seq++}`;

export const useChatStore = create<ChatState>((set, get) => ({
  me: ME,
  users: USERS,
  conversations: CONVERSATIONS,
  messages: MESSAGES,

  activeId: "c_aria",
  filter: "all",
  search: "",
  showDetails: false,
  replyTo: null,

  conversationById: (id) => get().conversations.find((c) => c.id === id),
  messagesFor: (id) =>
    get()
      .messages.filter((m) => m.conversationId === id)
      .sort((a, b) => a.createdAt - b.createdAt),
  userById: (id) => get().users[id],

  select: (id) => {
    set({ activeId: id, replyTo: null });
    get().markRead(id);
  },

  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  toggleDetails: () => set((s) => ({ showDetails: !s.showDetails })),
  setReplyTo: (replyTo) => set({ replyTo }),

  setDraft: (id, draft) =>
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, draft } : c)),
    })),

  markRead: (id) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, unreadCount: 0, lastReadAt: Date.now() } : c,
      ),
    })),

  sendMessage: (id, body) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const replyToId = get().replyTo?.id;
    const m: Message = {
      id: nextId("m"),
      conversationId: id,
      senderId: "me",
      kind: "text",
      body: trimmed,
      createdAt: Date.now(),
      status: "sending",
      replyToId,
    };
    set((s) => ({
      messages: [...s.messages, m],
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, draft: "" } : c)),
      replyTo: null,
    }));

    // Simulate the encrypt -> relay -> deliver -> read lifecycle.
    const advance = (status: Message["status"], delay: number) =>
      setTimeout(() => {
        set((s) => ({
          messages: s.messages.map((x) => (x.id === m.id ? { ...x, status } : x)),
        }));
      }, delay);
    advance("sent", 280);
    advance("delivered", 900);
    advance("read", 2100);
  },

  appendOutgoing: (conversationId, body) => {
    const trimmed = body.trim();
    const id = nextId("m");
    if (!trimmed) return id;
    const m: Message = {
      id,
      conversationId,
      senderId: "me",
      kind: "text",
      body: trimmed,
      createdAt: Date.now(),
      status: "sending",
    };
    set((s) => ({
      messages: [...s.messages, m],
      conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, draft: "" } : c)),
    }));
    return id;
  },

  setMessageStatus: (messageId, status) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? { ...m, status } : m)),
    })),

  startLiveConversation: ({ peerUserId, username }) => {
    const { users, conversations, convId } = ensureLivePeer(get(), peerUserId, username);
    set({ users, conversations, activeId: convId, replyTo: null });
    get().markRead(convId);
    return convId;
  },

  receiveLiveMessage: ({ peerUserId, username, text }) => {
    set((s) => {
      const { users, conversations, convId } = ensureLivePeer(s, peerUserId, username);
      const m: Message = {
        id: nextId("m"),
        conversationId: convId,
        senderId: peerUserId,
        kind: "text",
        body: text,
        createdAt: Date.now(),
        status: "read",
      };
      const isActive = s.activeId === convId;
      return {
        users,
        messages: [...s.messages, m],
        conversations: conversations.map((c) =>
          c.id === convId ? { ...c, unreadCount: isActive ? 0 : c.unreadCount + 1 } : c,
        ),
      };
    });
  },

  toggleReaction: (messageId, emoji) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = [...(m.reactions ?? [])];
        const idx = reactions.findIndex((r) => r.emoji === emoji);
        if (idx === -1) {
          reactions.push({ emoji, userIds: ["me"] });
        } else {
          const r = reactions[idx];
          const has = r.userIds.includes("me");
          const userIds = has ? r.userIds.filter((u) => u !== "me") : [...r.userIds, "me"];
          if (userIds.length === 0) reactions.splice(idx, 1);
          else reactions[idx] = { ...r, userIds };
        }
        return { ...m, reactions };
      }),
    })),
}));
