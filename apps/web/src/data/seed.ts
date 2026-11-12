import type { Conversation, Message, User } from "@/types";

// Demo data so the UI is alive before the crypto core and backend are wired.
// All of this will later come from the local encrypted store, populated by
// decrypting envelopes fetched from the relay.

const now = Date.now();
const min = 60_000;
const hour = 60 * min;

export const ME: User = {
  id: "me",
  name: "Mehrose",
  handle: "@mehrose",
  avatarHue: 152,
  presence: "online",
  about: "Building Raven.",
};

export const USERS: Record<string, User> = {
  me: ME,
  u_aria: {
    id: "u_aria",
    name: "Aria Novak",
    handle: "@aria",
    avatarHue: 168,
    presence: "online",
    about: "Designer. Lover of dark mode.",
  },
  u_kade: {
    id: "u_kade",
    name: "Kade Mensah",
    handle: "@kade",
    avatarHue: 134,
    presence: "away",
    lastSeen: now - 22 * min,
    about: "Infra & distributed systems.",
  },
  u_sol: {
    id: "u_sol",
    name: "Sol Vaughn",
    handle: "@sol",
    avatarHue: 96,
    presence: "offline",
    lastSeen: now - 5 * hour,
  },
  u_ines: {
    id: "u_ines",
    name: "Inès Rahimi",
    handle: "@ines",
    avatarHue: 190,
    presence: "online",
  },
  u_theo: {
    id: "u_theo",
    name: "Theo Lund",
    handle: "@theo",
    avatarHue: 112,
    presence: "offline",
    lastSeen: now - 2 * hour,
  },
};

export const CONVERSATIONS: Conversation[] = [
  {
    id: "c_aria",
    kind: "direct",
    title: "Aria Novak",
    memberIds: ["me", "u_aria"],
    avatarHue: 168,
    trust: "verified",
    pinned: true,
    unreadCount: 2,
    lastReadAt: now - 4 * min,
    typingUserIds: ["u_aria"],
    disappearingSeconds: 0,
  },
  {
    id: "c_crew",
    kind: "group",
    title: "Signal Crew",
    memberIds: ["me", "u_aria", "u_kade", "u_sol", "u_ines"],
    avatarHue: 150,
    trust: "verified",
    unreadCount: 7,
    lastReadAt: now - 30 * min,
    typingUserIds: [],
    description: "Where the build happens.",
    adminIds: ["me", "u_kade"],
    disappearingSeconds: 604800,
  },
  {
    id: "c_kade",
    kind: "direct",
    title: "Kade Mensah",
    memberIds: ["me", "u_kade"],
    avatarHue: 134,
    trust: "unverified",
    unreadCount: 0,
    lastReadAt: now - 1 * hour,
    typingUserIds: [],
  },
  {
    id: "c_ines",
    kind: "direct",
    title: "Inès Rahimi",
    memberIds: ["me", "u_ines"],
    avatarHue: 190,
    trust: "changed",
    unreadCount: 1,
    lastReadAt: now - 3 * hour,
    typingUserIds: [],
  },
  {
    id: "c_sol",
    kind: "direct",
    title: "Sol Vaughn",
    memberIds: ["me", "u_sol"],
    avatarHue: 96,
    trust: "verified",
    muted: true,
    unreadCount: 0,
    lastReadAt: now - 6 * hour,
    typingUserIds: [],
  },
  {
    id: "c_theo",
    kind: "direct",
    title: "Theo Lund",
    memberIds: ["me", "u_theo"],
    avatarHue: 112,
    trust: "verified",
    unreadCount: 0,
    lastReadAt: now - 26 * hour,
    typingUserIds: [],
  },
];

function msg(m: Partial<Message> & Pick<Message, "id" | "conversationId" | "senderId" | "createdAt">): Message {
  return {
    kind: "text",
    status: "read",
    ...m,
  } as Message;
}

export const MESSAGES: Message[] = [
  // Aria
  msg({ id: "m1", conversationId: "c_aria", senderId: "u_aria", createdAt: now - 3 * hour, body: "Did you see the new ratchet visualization? It finally clicks." }),
  msg({ id: "m2", conversationId: "c_aria", senderId: "me", createdAt: now - 3 * hour + 2 * min, body: "Yes! The per-message key derivation is so clean once it's drawn out." }),
  msg({
    id: "m3",
    conversationId: "c_aria",
    senderId: "u_aria",
    createdAt: now - 2 * hour,
    kind: "image",
    body: "Mockup for the safety-number screen 👇",
    attachment: { id: "a1", kind: "image", width: 480, height: 320, previewColor: "#13302a" },
  }),
  msg({ id: "m4", conversationId: "c_aria", senderId: "me", createdAt: now - 2 * hour + 5 * min, body: "This is gorgeous. Shipping it.", reactions: [{ emoji: "🔥", userIds: ["u_aria"] }] }),
  msg({ id: "m5", conversationId: "c_aria", senderId: "u_aria", createdAt: now - 6 * min, body: "One more thing about the key-change banner —" }),
  msg({ id: "m6", conversationId: "c_aria", senderId: "u_aria", createdAt: now - 4 * min, body: "should it block sending until the user re-verifies?" }),

  // Crew group
  msg({ id: "g1", conversationId: "c_crew", senderId: "u_kade", createdAt: now - 2 * hour, body: "MLS group re-key on member removal is working on my branch." }),
  msg({ id: "g2", conversationId: "c_crew", senderId: "u_ines", createdAt: now - 95 * min, body: "Removed members lose access to all future messages — confirmed with a test." }),
  msg({ id: "g3", conversationId: "c_crew", senderId: "me", createdAt: now - 90 * min, body: "Beautiful. That's the whole point of the ratchet tree." }),
  msg({
    id: "g4",
    conversationId: "c_crew",
    senderId: "u_sol",
    createdAt: now - 40 * min,
    kind: "file",
    body: "Audit checklist draft",
    attachment: { id: "a2", kind: "file", name: "raven-audit-checklist.pdf", size: 284_000 },
  }),
  msg({ id: "g5", conversationId: "c_crew", senderId: "u_aria", createdAt: now - 30 * min, body: "Adding the metadata-minimization section now." }),

  // Kade
  msg({ id: "k1", conversationId: "c_kade", senderId: "u_kade", createdAt: now - 1 * hour, body: "Relay node is stateless now — scales horizontally. Breach yields only ciphertext." }),
  msg({ id: "k2", conversationId: "c_kade", senderId: "me", createdAt: now - 58 * min, body: "That's exactly the property we want. Nice." }),

  // Inès
  msg({ id: "i1", conversationId: "c_ines", senderId: "u_ines", createdAt: now - 3 * hour, body: "Heads up: I re-installed on a new laptop, so my key rotated." }),

  // Sol
  msg({ id: "s1", conversationId: "c_sol", senderId: "u_sol", createdAt: now - 6 * hour, body: "Sealed sender is in. Server sees the recipient, not the sender." }),

  // Theo
  msg({ id: "t1", conversationId: "c_theo", senderId: "u_theo", createdAt: now - 26 * hour, body: "Let's sync on the Tauri packaging next week." }),
];
