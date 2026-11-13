/**
 * Supabase transport: the ciphertext relay + offline queue backed by the
 * `messages` table (migration 0002). Sends insert a row; the offline queue is a
 * select of the device's rows; realtime delivery is a postgres_changes INSERT
 * subscription (RLS ensures a device only sees its own rows); ack deletes.
 *
 * Only opaque ciphertext and routing metadata are stored. Requires an
 * authenticated Supabase session (the device's account).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueuedEnvelope, Transport, WireEnvelope } from "./transport";

interface MessageRow {
  id: number;
  sender_user: string;
  sender_device: string;
  recipient_user: string;
  recipient_device: string;
  ciphertext: string;
}

function toEnvelope(row: MessageRow): QueuedEnvelope {
  return {
    id: String(row.id),
    senderUser: row.sender_user,
    senderDevice: row.sender_device,
    recipientUser: row.recipient_user,
    recipientDevice: row.recipient_device,
    ciphertext: row.ciphertext,
  };
}

export class SupabaseTransport implements Transport {
  constructor(
    private readonly db: SupabaseClient,
    private readonly selfUserId: string,
    private readonly selfDevice: string,
  ) {}

  async send(env: WireEnvelope): Promise<void> {
    const { error } = await this.db.from("messages").insert({
      sender_user: env.senderUser,
      sender_device: env.senderDevice,
      recipient_user: env.recipientUser,
      recipient_device: env.recipientDevice,
      ciphertext: env.ciphertext,
    });
    if (error) throw error;
  }

  async fetchQueued(): Promise<QueuedEnvelope[]> {
    const { data, error } = await this.db
      .from("messages")
      .select("*")
      .eq("recipient_user", this.selfUserId)
      .eq("recipient_device", this.selfDevice)
      .order("id", { ascending: true });
    if (error) throw error;
    return (data as MessageRow[]).map(toEnvelope);
  }

  subscribe(onEnvelope: (env: QueuedEnvelope) => void): () => void {
    const channel = this.db
      .channel(`inbox:${this.selfDevice}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `recipient_device=eq.${this.selfDevice}`,
        },
        (payload) => onEnvelope(toEnvelope(payload.new as MessageRow)),
      )
      .subscribe();
    return () => {
      void this.db.removeChannel(channel);
    };
  }

  async ack(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { error } = await this.db
      .from("messages")
      .delete()
      .in(
        "id",
        ids.map((i) => Number(i)),
      );
    if (error) throw error;
  }
}
