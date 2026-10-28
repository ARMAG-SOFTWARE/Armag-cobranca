import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Alerta de sistema (hoje só falha de backup) via WhatsApp, reaproveitando
 * o mesmo provedor já configurado em `message_settings` — nenhuma
 * integração nova. Só envia se houver um `admin_alert_phone` configurado
 * (Ajustes → Alertas de sistema); do contrário não faz nada, sem erro.
 *
 * Nunca lança: uma falha ao notificar não pode virar um segundo problema
 * em cima do backup que já falhou. O texto do alerta nunca inclui senha,
 * token, chave de criptografia, connection string ou dado de cliente —
 * só o que já é seguro aparecer numa mensagem de texto simples.
 */
export async function sendBackupFailureAlert(supabase: SupabaseClient, summary: string): Promise<void> {
  try {
    const { data: settings } = await supabase
      .from("message_settings")
      .select("*")
      .eq("is_active", true)
      .maybeSingle();

    if (!settings?.admin_alert_phone) return;

    const { createWhatsAppProvider } = await import("@/lib/whatsapp/providers");
    const provider = createWhatsAppProvider(settings);
    await provider.send(settings.admin_alert_phone, {
      text: `⚠️ ALERTA: Falha no backup automático.\n\n${summary}`,
      templateParams: ["Backup automático", "-", "-", summary],
    });
  } catch {
    // Best-effort — o e-mail de falha do GitHub Actions continua sendo o
    // canal garantido; este é só um reforço quando configurado.
  }
}
