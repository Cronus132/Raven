/**
 * Live messaging wiring: connects the MessagingService to the chat UI.
 *
 * Started on unlock (once a Supabase session exists), it drains the offline
 * queue, subscribes for realtime, and routes decrypted inbound messages into
 * the chat store. Sessions persist in the encrypted keystore. The session-store
 * wrapping key is derived (fast HKDF) from the keystore key already computed at
 * unlock, so no second scrypt runs here.
 */

import { supabase, isSupabaseConfigured } from "@/lib/backend/supabase";
import type { KeyDirectory } from "@/lib/crypto/directory";
import type { BundleSource } from "@/lib/crypto/messaging";
import { MessagingService } from "@/lib/crypto/messaging";
import type { DeviceSecret } from "@/lib/crypto/identity";
import type { AccountMeta } from "@/lib/crypto/keystore";
import { KeystoreSessionStore } from "@/lib/crypto/keystoreSessionStore";
import { SupabaseTransport } from "@/lib/transport/supabaseTransport";
import { hkdfSha256, utf8 } from "@/lib/crypto/primitives";
import { useChatStore } from "@/store/useChatStore";

let service: MessagingService | null = null;
let directoryRef: KeyDirectory | null = null;

export function isLiveMessaging(): boolean {
  return service != null;
}

export async function startMessaging(
  secret: DeviceSecret,
  meta: AccountMeta,
  wrappingKey: Uint8Array,
  directory: KeyDirectory,
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  stopMessaging();
  directoryRef = directory;

  // Session-store key: domain-separated from the keystore key (no extra scrypt).
  const sessionKey = hkdfSha256(wrappingKey, utf8(`raven-sessions:${meta.userId}`), utf8("session-store"), 32);
  const transport = new SupabaseTransport(supabase, meta.userId, secret.deviceId);
  const store = new KeystoreSessionStore(sessionKey);
  const svc = new MessagingService(secret, meta.userId, directory as unknown as BundleSource, transport, store);

  svc.onMessage = async (m) => {
    let username = `user-${m.from.slice(0, 6)}`;
    try {
      username = (await directory.usernameOf?.(m.from)) ?? username;
    } catch {
      /* label fallback */
    }
    useChatStore.getState().receiveLiveMessage({ peerUserId: m.from, username, text: m.text, outgoing: m.outgoing });
  };

  // Realtime postgres_changes enforces RLS via the socket's auth token.
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) supabase.realtime.setAuth(data.session.access_token);
  } catch {
    /* no session yet */
  }

  service = svc;
  await svc.start();
}

export function stopMessaging(): void {
  service?.stop();
  service = null;
  directoryRef = null;
}

export async function sendLive(peerUserId: string, text: string): Promise<void> {
  if (!service) throw new Error("Messaging is offline — try again in a moment.");
  await service.sendText(peerUserId, text);
}

/** Resolve a public @username to an account, for starting a conversation. */
export async function lookupUser(username: string): Promise<{ userId: string; username: string } | undefined> {
  if (!directoryRef?.findUserByUsername) return undefined;
  return directoryRef.findUserByUsername(username);
}
