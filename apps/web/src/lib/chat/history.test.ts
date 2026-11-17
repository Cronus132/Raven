import { describe, expect, it } from "vitest";
import { deriveArchiveKey, deriveHistoryKey, openSnapshot, sealSnapshot, type HistorySnapshot } from "./historyStore";
import { useChatStore } from "@/store/useChatStore";
import { randomBytes, toHex } from "@/lib/crypto/primitives";
import type { Conversation, Message } from "@/types";

function sampleSnapshot(): HistorySnapshot {
  return {
    v: 1,
    users: {
      me: { id: "me", name: "You", handle: "@you", avatarHue: 152, presence: "online" },
      u1: { id: "u1", name: "Pat", handle: "@pat", avatarHue: 40, presence: "offline" },
    },
    conversations: [
      { id: "d_u1", kind: "direct", title: "Pat", memberIds: ["me", "u1"], avatarHue: 40, trust: "unverified", unreadCount: 0, lastReadAt: 1, typingUserIds: [], real: true, peerUserId: "u1" },
    ],
    messages: [
      { id: "m1", conversationId: "d_u1", senderId: "u1", kind: "text", body: "hello", createdAt: 10, status: "read" },
      { id: "m2", conversationId: "d_u1", senderId: "me", kind: "text", body: "hi back", createdAt: 20, status: "sent" },
    ],
  };
}

describe("message history codec", () => {
  it("round-trips a snapshot through seal → open with the derived key", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    const key = deriveHistoryKey(randomBytes(32), userId);
    const snap = sampleSnapshot();

    const rec = await sealSnapshot(userId, key, snap);
    expect(rec.ciphertext).not.toContain("hello"); // sealed, not plaintext

    const back = await openSnapshot(userId, key, rec);
    expect(back).toEqual(snap);
  });

  it("returns null when the key is wrong (e.g. passphrase changed)", async () => {
    const userId = "22222222-2222-2222-2222-222222222222";
    const rec = await sealSnapshot(userId, deriveHistoryKey(randomBytes(32), userId), sampleSnapshot());
    const wrong = deriveHistoryKey(randomBytes(32), userId);
    expect(await openSnapshot(userId, wrong, rec)).toBeNull();
  });

  it("binds the record to the user id (AAD) — another user's key can't open it", async () => {
    const wrapping = randomBytes(32);
    const rec = await sealSnapshot("user-a", deriveHistoryKey(wrapping, "user-a"), sampleSnapshot());
    // Same wrapping material, different user id → different derived key + AAD.
    expect(await openSnapshot("user-b", deriveHistoryKey(wrapping, "user-b"), rec)).toBeNull();
  });
});

describe("portable archive key (cross-device)", () => {
  it("is identical for the same passphrase + user on any device", () => {
    const a = deriveArchiveKey("correct horse battery staple", "user-123");
    const b = deriveArchiveKey("correct horse battery staple", "user-123");
    expect(toHex(a)).toBe(toHex(b)); // deterministic → a new device derives the same key
  });

  it("differs by passphrase and by user", () => {
    const base = toHex(deriveArchiveKey("passphrase-one", "user-123"));
    expect(toHex(deriveArchiveKey("passphrase-two", "user-123"))).not.toBe(base);
    expect(toHex(deriveArchiveKey("passphrase-one", "user-999"))).not.toBe(base);
  });

  it("round-trips the archive snapshot (new device restores history)", async () => {
    const userId = "33333333-3333-3333-3333-333333333333";
    const key = deriveArchiveKey("a strong passphrase", userId);
    const snap = sampleSnapshot();
    const rec = await sealSnapshot(userId, key, snap);
    // A second device derives the same key from the passphrase and opens it.
    const onNewDevice = deriveArchiveKey("a strong passphrase", userId);
    expect(await openSnapshot(userId, onNewDevice, rec)).toEqual(snap);
  });
});

describe("hydrateHistory merge", () => {
  it("restores saved history into an empty store", () => {
    useChatStore.getState().resetChat();
    useChatStore.getState().hydrateHistory(sampleSnapshot());
    const s = useChatStore.getState();
    expect(s.messages.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(s.conversations.map((c) => c.id)).toEqual(["d_u1"]);
    expect(s.users.u1?.name).toBe("Pat");
  });

  it("keeps the current in-memory copy on an id conflict (live message wins)", () => {
    useChatStore.getState().resetChat();
    const live: Message = { id: "m1", conversationId: "d_u1", senderId: "u1", kind: "text", body: "LIVE", createdAt: 99, status: "read" };
    const liveConv: Conversation = { id: "d_u1", kind: "direct", title: "Pat", memberIds: ["me", "u1"], avatarHue: 40, trust: "verified", unreadCount: 3, lastReadAt: 5, typingUserIds: [] };
    useChatStore.setState({ messages: [live], conversations: [liveConv] });

    useChatStore.getState().hydrateHistory(sampleSnapshot());
    const s = useChatStore.getState();
    expect(s.messages.find((m) => m.id === "m1")?.body).toBe("LIVE"); // not "hello"
    expect(s.messages.find((m) => m.id === "m2")?.body).toBe("hi back"); // stored-only filled in
    expect(s.conversations.find((c) => c.id === "d_u1")?.unreadCount).toBe(3); // live trust/unread kept
    useChatStore.getState().resetChat();
  });
});
