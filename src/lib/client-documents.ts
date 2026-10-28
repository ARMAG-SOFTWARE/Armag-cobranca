import type { createClient } from "@/lib/supabase/server";

/**
 * Gera uma signed URL temporária (1h) para a foto do documento de um cliente,
 * guardada no bucket privado `client-documents` — nunca uma URL pública.
 */
export async function getClientDocumentSignedUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 60 * 60);
  if (error || !data) return null;

  return data.signedUrl;
}
