import type { createClient } from "@/lib/supabase/server";

export interface AuditLogEntry {
  actorEmail: string | null;
  /**
   * Dono do registro (auth.users.id) — usado pela RLS da migration 0017
   * para restringir a leitura de `audit_logs` ao próprio usuário. `null`
   * só é válido para `login_failed` (gravado antes de existir sessão) —
   * qualquer outra ação deve sempre passar o id do usuário autenticado.
   */
  ownerId: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string | null;
  /**
   * Só dados já seguros para aparecer num relatório de auditoria: valores
   * monetários, IDs, nomes. NUNCA senha, token, cookie, secret ou o
   * conteúdo de um documento.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Registra uma ação sensível (login, exclusão, pagamento, acesso a
 * documento — itens 22/23 da auditoria de segurança). Nunca lança erro:
 * uma falha ao gravar o log jamais pode impedir/reverter a operação real
 * que está sendo registrada — auditoria é best-effort, não uma trava.
 */
export async function logAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entry: AuditLogEntry,
): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      actor_email: entry.actorEmail,
      owner_id: entry.ownerId,
      action: entry.action,
      resource_type: entry.resourceType ?? null,
      resource_id: entry.resourceId ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch {
    // Best-effort — nunca deixa uma falha de log derrubar a operação real.
  }
}
