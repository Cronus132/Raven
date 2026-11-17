import { create } from "zustand";
import type { Attachment, Conversation, Message, MessageStatus, TrustLevel, User } from "@/types";
import type { HistorySnapshot } from "@/lib/chat/historyStore";
import { CONVERSATIONS, MESSAGES, USERS, ME } from "@/data/seed";

type Filter = "all" | "unread" | "groups";
export type NavView = "chats" | "groups" | "calls" | "archive";

interface ChatState {
  me: User;
  users: Record<string, User>;
  conversations: Conversation[];
  messages: Message[];

  activeId: string | null;
  nav: NavView;
  filter: Filter;
  search: string;
  showDetails: boolean;
  replyTo: Message | null;

  // selectors
  conversationById: (id: string) => Conversation | undefined;
  messagesFor: (id: string) => Message[];
  userById: (id: string) => User | undefined;

  // actions
  hydrateHistory: (snap: HistorySnapshot) => void;
  resetChat: () => void;
  select: (id: string) => void;
  setNav: (v: NavView) => void;
  archiveConversation: (id: string, archived: boolean) => void;
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
  appendOutgoingMedia: (conversationId: string, attachment: Attachment, caption?: string) => string;
  setMessageStatus: (messageId: string, status: MessageStatus) => void;
  startLiveConversation: (peer: { peerUserId: string; username: string }) => string;
  receiveLiveMessage: (msg: {
    peerUserId: string;
    username: string;
    text: string;
    outgoing?: boolean;
    remoteId?: string;
    attachment?: Attachment;
  }) => void;
  inboundRemoteIds: (conversationId: string) => string[];
  startGroupConversation: (g: { groupId: string; name: string; members: { userId: string; username: string }[] }) => string;
  receiveGroupMessage: (m: {
    groupId: string;
    name: string;
    from: string;
    username: string;
    text: string;
    outgoing?: boolean;
  }) => void;
  setOnlineUsers: (userIds: string[]) => void;
  setPeerTyping: (peerUserId: string, typing: boolean) => void;
  setConversationTrust: (conversationId: string, trust: TrustLevel) => void;
}

const isUuidId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

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

/** Ensure a group conversation (and any named members) exist; returns its id. */
function ensureLiveGroup(
  s: ChatState,
  groupId: string,
  name: string,
  memberEntries: { userId: string; username: string }[] = [],
): { users: Record<string, User>; conversations: Conversation[]; convId: string } {
  const convId = `g_${groupId}`;
  const hue = hueFromId(groupId);
  let users = s.users;
  for (const m of memberEntries) {
    if (m.userId === "me" || users[m.userId]) continue;
    users = {
      ...users,
      [m.userId]: { id: m.userId, name: m.username, handle: `@${m.username}`, avatarHue: hueFromId(m.userId), presence: "offline" },
    };
  }
  const memberIds = ["me", ...memberEntries.map((m) => m.userId)];
  const conversations = s.conversations.some((c) => c.id === convId)
    ? s.conversations
    : [
        {
          id: convId,
          kind: "group" as const,
          title: name,
          memberIds,
          avatarHue: hue,
          trust: "unverified" as const,
          unreadCount: 0,
          lastReadAt: 0,
          typingUserIds: [],
          real: true,
          groupId,
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

  activeId: null,
  nav: "chats",
  filter: "all",
  search: "",
  showDetails: false,
  replyTo: null,

  // Merge a saved snapshot into the live store. Current (in-memory) entries win
  // on id conflicts so a just-arrived live message/receipt is never clobbered by
  // an older persisted copy; stored-only entries fill in the restored history.
  hydrateHistory: (snap) =>
    set((s) => {
      const msgs = new Map<string, Message>();
      for (const m of snap.messages) msgs.set(m.id, m);
      for (const m of s.messages) msgs.set(m.id, m);
      const convs = new Map<string, Conversation>();
      for (const c of snap.conversations) convs.set(c.id, c);
      for (const c of s.conversations) convs.set(c.id, c);
      return {
        users: { ...snap.users, ...s.users },
        conversations: [...convs.values()],
        messages: [...msgs.values()],
      };
    }),

  resetChat: () => set({ users: { me: ME }, conversations: [], messages: [], activeId: null }),

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

  setNav: (nav) => set({ nav }),
  archiveConversation: (id, archived) =>
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, archived } : c)),
      activeId: archived && s.activeId === id ? null : s.activeId,
    })),

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

  appendOutgoingMedia: (conversationId, attachment, caption) => {
    const id = nextId("m");
    const m: Message = {
      id,
      conversationId,
      senderId: "me",
      kind: attachment.kind === "image" ? "image" : "file",
      body: caption,
      attachment,
      createdAt: Date.now(),
      status: "sending",
    };
    set((s) => ({ messages: [...s.messages, m] }));
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

  inboundRemoteIds: (conversationId) =>
    get()
      .messages.filter((m) => m.conversationId === conversationId && m.senderId !== "me" && m.remoteId)
      .map((m) => m.remoteId as string),

  startGroupConversation: ({ groupId, name, members }) => {
    const { users, conversations, convId } = ensureLiveGroup(get(), groupId, name, members);
    set({ users, conversations, activeId: convId, replyTo: null });
    get().markRead(convId);
    return convId;
  },

  receiveGroupMessage: ({ groupId, name, from, username, text, outgoing }) => {
    set((s) => {
      const { users, conversations, convId } = ensureLiveGroup(s, groupId, name, [{ userId: from, username }]);
      const m: Message = {
        id: nextId("m"),
        conversationId: convId,
        senderId: outgoing ? "me" : from,
        kind: "text",
        body: text,
        createdAt: Date.now(),
        status: outgoing ? "sent" : "read",
      };
      const bump = !outgoing && s.activeId !== convId;
      return {
        users,
        messages: [...s.messages, m],
        conversations: conversations.map((c) =>
          c.id === convId ? { ...c, unreadCount: bump ? c.unreadCount + 1 : c.unreadCount } : c,
        ),
      };
    });
  },

  setOnlineUsers: (userIds) =>
    set((s) => {
      const online = new Set(userIds);
      const users = { ...s.users };
      let changed = false;
      for (const id of Object.keys(users)) {
        if (id === "me" || !isUuidId(id)) continue; // leave demo contacts alone
        const presence = online.has(id) ? "online" : "offline";
        if (users[id].presence !== presence) {
          users[id] = { ...users[id], presence };
          changed = true;
        }
      }
      return changed ? { users } : {};
    }),

  setPeerTyping: (peerUserId, typing) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === `d_${peerUserId}` ? { ...c, typingUserIds: typing ? [peerUserId] : [] } : c,
      ),
    })),

  setConversationTrust: (conversationId, trust) =>
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, trust } : c)),
    })),

  receiveLiveMessage: ({ peerUserId, username, text, outgoing, remoteId, attachment }) => {
    set((s) => {
      const { users, conversations, convId } = ensureLivePeer(s, peerUserId, username);
      // `outgoing` = a copy of our own message synced from another of our devices.
      const kind = attachment ? (attachment.kind === "image" ? "image" : "file") : "text";
      const m: Message = {
        id: nextId("m"),
        conversationId: convId,
        senderId: outgoing ? "me" : peerUserId,
        kind,
        body: text || undefined,
        attachment,
        createdAt: Date.now(),
        status: outgoing ? "sent" : "read",
        remoteId: outgoing ? undefined : remoteId,
      };
      const bump = !outgoing && s.activeId !== convId;
      return {
        users,
        messages: [...s.messages, m],
        conversations: conversations.map((c) =>
          c.id === convId ? { ...c, unreadCount: bump ? c.unreadCount + 1 : c.unreadCount } : c,
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
