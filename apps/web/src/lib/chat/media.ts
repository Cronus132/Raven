/**
 * Attachment upload/download. The blob is encrypted client-side; only ciphertext
 * reaches Supabase Storage (bucket `attachments`, migration 0003). The decryption
 * key travels only inside the E2E-encrypted message.
 */

import { supabase } from "@/lib/backend/supabase";
import { decryptBytes, encryptBytes } from "@/lib/crypto/attachments";
import type { MediaRef } from "@/lib/crypto/messaging";

const BUCKET = "attachments";

export async function uploadAttachment(file: File): Promise<MediaRef> {
  if (!supabase) throw new Error("Backend not configured");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { ciphertext, key, iv } = await encryptBytes(bytes);
  const path = crypto.randomUUID();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, ciphertext, { contentType: "application/octet-stream", upsert: false });
  if (error) throw error;
  return {
    path,
    key,
    iv,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    kind: file.type.startsWith("image/") ? "image" : "file",
  };
}

/** Download the ciphertext, decrypt it, and return an object URL for rendering. */
export async function downloadAttachment(ref: {
  path: string;
  key: string;
  iv: string;
  mime?: string;
}): Promise<string> {
  if (!supabase) throw new Error("Backend not configured");
  const { data, error } = await supabase.storage.from(BUCKET).download(ref.path);
  if (error || !data) throw error ?? new Error("download failed");
  const ciphertext = new Uint8Array(await data.arrayBuffer());
  const bytes = await decryptBytes(ciphertext, ref.key, ref.iv);
  const blob = new Blob([bytes], { type: ref.mime || "application/octet-stream" });
  return URL.createObjectURL(blob);
}
