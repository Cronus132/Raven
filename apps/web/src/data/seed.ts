import type { Conversation, Message, User } from "@/types";

// The local user's own profile. Name/handle are overwritten from the real
// account (see syncMe in useIdentityStore) once the identity is unlocked.
// A fresh install starts empty — no contacts, conversations, or messages exist
// until this device actually talks to someone (NewChatDialog → lookupUser) or
// receives a live message from the relay.

export const ME: User = {
  id: "me",
  name: "You",
  handle: "@you",
  avatarHue: 152,
  presence: "online",
};

export const USERS: Record<string, User> = {
  me: ME,
};

export const CONVERSATIONS: Conversation[] = [];

export const MESSAGES: Message[] = [];
