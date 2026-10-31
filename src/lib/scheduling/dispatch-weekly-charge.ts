import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, format, parseISO } from "date-fns";

import { createWhatsAppProvider } from "@/lib/whatsapp/providers";
import { buildReminderTemplateParams, renderReminderMessage } from "@/lib/whatsapp/template";
import { varyMessage } from "@/lib/whatsapp/spintax";
import type { Client, Installment, MessageSettings, Periodicity } from "@/lib/types";

export interface DispatchResult {
  ok: boolean;
  skippedReason?: "not_pending" | "fully_paid" | "not_found";
  error?: string;
}

interface WeeklyChargeWithRelations {
  id: string;
  proximo_disparo: string;
  dispatch_count: number;
  contract: {
    type: "emprestimo" | "venda_iphone";
    principal_amount: number;
    installments_count: number;
    late_interest_rate_percent_per_day: number;
    periodicity: Periodicity;
    client: Client;
    installments: Installment[];
  };
}

/**
 * Dispara a cobrança de UM contrato semanal, com re-checagem de status em
 * tempo real imediatamente antes do envio (o admin pode ter marcado a
 * parcela como paga/cancelada enquanto a fila estava rodando).
 */
export async function dispatchWeeklyCharge(
  supabase: SupabaseClient,
  weeklyChargeId: string,
  settings: MessageSettings,
): Promise<DispatchResult> {
  // Re-checagem em tempo real: aborta se não estiver mais PENDENTE.
  const { data: liveStatus } = await supabase
    .from("weekly_charges")
    .select("status")
    .eq("id", weeklyChargeId)
    .single();

  if (!liveStatus || liveStatus.status !== "PENDENTE") {
    return { ok: false, skippedReason: "not_pending" };
  }

  const { data, error } = await supabase
    .from("weekly_charges")
    .select(
      "id, proximo_disparo, dispatch_count, contract:contracts(type, principal_amount, installments_count, late_interest_rate_percent_per_day, periodicity, client:clients(*), installments(*))",
    )
    .eq("id", weeklyChargeId)
    .single();

  if (error || !data) {
    return { ok: false, skippedReason: "not_found", error: error?.message };
  }

  const charge = data as unknown as WeeklyChargeWithRelations;
  const client = charge.contract.client;
  const pendingInstallment = [...charge.contract.installments]
    .filter((installment) => installment.status !== "pago")
    .sort((a, b) => a.number - b.number)[0];

  if (!pendingInstallment) {
    // Todas as parcelas já foram pagas: encerra o ciclo de disparo semanal.
    await supabase.from("weekly_charges").update({ status: "PAGO" }).eq("id", weeklyChargeId);
    return { ok: false, skippedReason: "fully_paid" };
  }

  const baseMessage = renderReminderMessage(
    settings.message_template,
    client,
    charge.contract,
    pendingInstallment,
    charge.contract.installments_count,
  );
  const finalMessage = varyMessage(baseMessage);
  const templateParams = buildReminderTemplateParams(client, pendingInstallment, charge.contract.installments_count);

  try {
    const provider = createWhatsAppProvider(settings);
    const result = await provider.send(client.phone, { text: finalMessage, templateParams });

    await supabase.from("message_logs").insert({
      owner_id: client.owner_id,
      installment_id: pendingInstallment.id,
      client_id: client.id,
      status: result.ok ? "sent" : "failed",
      provider_response: result.body,
    });

    if (!result.ok) {
      return { ok: false, error: `Falha ao enviar (HTTP ${result.statusCode}).` };
    }

    const nextDispatch = format(addDays(parseISO(charge.proximo_disparo), 7), "yyyy-MM-dd");
    await supabase
      .from("weekly_charges")
      .update({
        proximo_disparo: nextDispatch,
        last_dispatch_at: new Date().toISOString(),
        dispatch_count: (charge.dispatch_count ?? 0) + 1,
      })
      .eq("id", weeklyChargeId);

    await supabase
      .from("installments")
      .update({
        reminder_sent_at: new Date().toISOString(),
        reminder_count: (pendingInstallment.reminder_count ?? 0) + 1,
      })
      .eq("id", pendingInstallment.id);

    return { ok: true };
  } catch (error) {
    await supabase.from("message_logs").insert({
      owner_id: client.owner_id,
      installment_id: pendingInstallment.id,
      client_id: client.id,
      status: "failed",
      provider_response: { message: error instanceof Error ? error.message : String(error) },
    });

    return { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido ao enviar mensagem." };
  }
}
