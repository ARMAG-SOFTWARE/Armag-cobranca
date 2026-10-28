import type { SupabaseClient } from "@supabase/supabase-js";

import { createWhatsAppProvider } from "@/lib/whatsapp/providers";
import { buildReminderTemplateParams, renderReminderMessage } from "@/lib/whatsapp/template";

export interface SendReminderResult {
  ok: boolean;
  error?: string;
}

/**
 * Envia (ou reenvia) a cobrança de uma parcela via WhatsApp, usando a
 * configuração ativa em `message_settings`. Registra o resultado em
 * `message_logs` e atualiza `reminder_sent_at` / `reminder_count`.
 */
export async function sendCollectionReminder(
  supabase: SupabaseClient,
  installmentId: string,
): Promise<SendReminderResult> {
  const { data: installment, error: installmentError } = await supabase
    .from("installments")
    .select("*, contract:contracts(*, client:clients(*))")
    .eq("id", installmentId)
    .single();

  if (installmentError || !installment) {
    return { ok: false, error: "Parcela não encontrada." };
  }

  const contract = installment.contract as {
    owner_id: string;
    type: "emprestimo" | "venda_iphone";
    principal_amount: number;
    installments_count: number;
    client: { id: string; name: string; phone: string };
  };
  const client = contract.client;

  // Cada usuário tem a sua própria configuração ativa de WhatsApp — essencial
  // aqui porque esta função também roda pelo cron com um cliente de
  // service-role (que ignora RLS, então sem este filtro explícito pegaria
  // a configuração "ativa" de QUALQUER usuário, não necessariamente a do
  // dono real desta parcela).
  const { data: settings, error: settingsError } = await supabase
    .from("message_settings")
    .select("*")
    .eq("owner_id", contract.owner_id)
    .eq("is_active", true)
    .maybeSingle();

  if (settingsError || !settings) {
    return { ok: false, error: "Nenhuma configuração de WhatsApp ativa. Configure em Ajustes." };
  }

  // Sem saudação — tom firme e direto pedido pelo usuário para toda
  // mensagem de cobrança, automática ou manual.
  const message = renderReminderMessage(
    settings.message_template,
    client,
    contract,
    installment,
    contract.installments_count,
  );
  const templateParams = buildReminderTemplateParams(client, installment, contract.installments_count);

  try {
    const provider = createWhatsAppProvider(settings);
    const result = await provider.send(client.phone, { text: message, templateParams });

    await supabase.from("message_logs").insert({
      owner_id: contract.owner_id,
      installment_id: installment.id,
      client_id: client.id,
      status: result.ok ? "sent" : "failed",
      provider_response: result.body,
    });

    if (result.ok) {
      await supabase
        .from("installments")
        .update({
          reminder_sent_at: new Date().toISOString(),
          reminder_count: (installment.reminder_count ?? 0) + 1,
        })
        .eq("id", installment.id);

      return { ok: true };
    }

    return { ok: false, error: `Falha ao enviar (HTTP ${result.statusCode}).` };
  } catch (error) {
    await supabase.from("message_logs").insert({
      owner_id: contract.owner_id,
      installment_id: installment.id,
      client_id: client.id,
      status: "failed",
      provider_response: { message: error instanceof Error ? error.message : String(error) },
    });

    return { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido ao enviar mensagem." };
  }
}
