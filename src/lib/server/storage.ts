import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_BYTES = 2_000_000;

/** Enregistre une image envoyée en data URL dans le bucket public « bouquets ». */
export async function uploadDataUrl(db: SupabaseClient, path: string, dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) throw Object.assign(new Error("Image invalide (JPEG, PNG ou WebP)"), { status: 400 });
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_BYTES) throw Object.assign(new Error("Image trop lourde (2 Mo maximum)"), { status: 413 });
  const { error } = await db.storage.from("bouquets").upload(path, bytes, { contentType: m[1], upsert: true });
  if (error) throw error;
  return db.storage.from("bouquets").getPublicUrl(path).data.publicUrl;
}
