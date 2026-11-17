// Core domain types for the Raven client.
// These model what the *client* works with (decrypted, in-memory). The server
// only ever sees the ciphertext envelopes derived from these.

export type Presence = "online" | "away" | "offline";

export type TrustLevel = "verified" | "unverified" | "changed";

export interface User {
  id: string;
  name: string;
  handle: string; // public username, e.g. @mehrose
  avatarHue: number; // used to generate a deterministic gradient avatar
  presence: Presence;
  lastSeen?: number;
  about?: string;
}

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export type MessageKind = "text" | "image" | "file" | "voice" | "system";

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Attachment {
  id: string;
  kind: "image" | "file" | "voice";
  name?: string;
  size?: number; // bytes
  width?: number;
  height?: number;
  duration?: number; // seconds (voice)
  previewColor?: string;
  // Real encrypted attachment: ciphertext storage path + per-blob key (client only).
  mime?: string;
  path?: string;
  key?: string;
  iv?: string;
  // Client-only decrypted/preview object URL (never serialized to the wire).
  url?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body?: string;
  attachment?: Attachment;
  createdAt: number;
  status: MessageStatus;
  reactions?: Reaction[];
  replyToId?: string;
  editedAt?: number;
  // the sender's message id for an inbound live message (used to send read receipts)
  remoteId?: string;
  // disappearing-message TTL in seconds, enforced on the client
  expiresInSeconds?: number;
}

export type ConversationKind = "direct" | "group";

export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string; // group name, or derived from the other member for direct
  memberIds: string[];
  avatarHue: number;
  trust: TrustLevel; // safety-number state for direct; group verification summary
  muted?: boolean;
  pinned?: boolean;
  archived?: boolean;
  unreadCount: number;
  lastReadAt: number;
  draft?: string;
  typingUserIds: string[];
  // group-only
  description?: string;
  adminIds?: string[];
  disappearingSeconds?: number;
  // live (real, E2E) direct conversation: the peer's account id. Demo seed
  // conversations leave this unset and use the simulated send path.
  real?: boolean;
  peerUserId?: string;
  // live group: the group id (Sender Keys). Set for real group conversations.
  groupId?: string;
}
