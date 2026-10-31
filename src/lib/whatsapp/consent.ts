import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Consentimento/bloqueio de contato da Central de WhatsApp. A tabela
 * `whatsapp_consents` (migration 0026) só GUARDA o estado — quem precisa
 * BARRAR o envio é o código da fila de campanha, usando estes helpers antes
 * de disparar qualquer mensagem. Respeitar o bloqueio é exigência de LGPD e
 * também o que evita banimento do número por spam.
 */

/** Um único contato está bloqueado para cobrança? (default: não bloqueado) */
export async function isContactBlocked(
  supabase: SupabaseClient,
  ownerId: string,
  clientId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("whatsapp_consents")
    .select("is_blocked")
    .eq("owner_id", ownerId)
    .eq("client_id", clientId)
    .eq("category", "cobranca")
    .maybeSingle();

  return data?.is_blocked === true;
}

/**
 * Dada uma lista de client_ids, devolve só os que NÃO estão bloqueados —
 * para a fila pré-filtrar o público da campanha numa única consulta, em vez
 * de uma por contato. Ausência de registro = não bloqueado (opt-out, não
 * opt-in): o padrão do sistema é poder cobrar, e o bloqueio é explícito.
 */
export async function filterAllowedClientIds(
  supabase: SupabaseClient,
  ownerId: string,
  clientIds: string[],
): Promise<string[]> {
  if (clientIds.length === 0) return [];

  const { data } = await supabase
    .from("whatsapp_consents")
    .select("client_id")
    .eq("owner_id", ownerId)
    .eq("category", "cobranca")
    .eq("is_blocked", true)
    .in("client_id", clientIds);

  const blocked = new Set((data ?? []).map((row: { client_id: string }) => row.client_id));
  return clientIds.filter((id) => !blocked.has(id));
}
