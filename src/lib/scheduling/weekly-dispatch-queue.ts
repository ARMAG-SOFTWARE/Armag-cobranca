import type { SupabaseClient } from "@supabase/supabase-js";

import { dispatchWeeklyCharge } from "@/lib/scheduling/dispatch-weekly-charge";
import { getBrazilDateString, getBrazilIsoWeekday, isWithinDispatchWindow } from "@/lib/scheduling/time-window";
import { checkEvolutionConnection } from "@/lib/whatsapp/evolution-health";
import { checkMetaConnection } from "@/lib/whatsapp/meta-health";
import type { WhatsAppProviderName } from "@/lib/types";

// Delay randômico anti-banimento — só necessário para o Evolution API
// (automação não-oficial via WhatsApp Web). A Meta Cloud API é uma API
// oficial e sancionada, sem risco de banimento por volume/cadência, então
// usa apenas um intervalo mínimo por boa prática de uso de API.
const EVOLUTION_MIN_DELAY_MS = 60_000;
const EVOLUTION_MAX_DELAY_MS = 120_000;
const META_DELAY_MS = 300;

// Margem de segurança para a fila parar antes do timeout da function,
// deixando tempo para a última atualização no banco terminar.
const SAFETY_BUFFER_MS = 20_000;
const DEFAULT_BUDGET_MS = 280_000;

function delayForProvider(provider: WhatsAppProviderName) {
  if (provider === "evolution") {
    return EVOLUTION_MIN_DELAY_MS + Math.floor(Math.random() * (EVOLUTION_MAX_DELAY_MS - EVOLUTION_MIN_DELAY_MS));
  }
  return META_DELAY_MS;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WeeklyDispatchSummary {
  ok: boolean;
  reason?: string;
  totalDue: number;
  sent: number;
  skipped: number;
  failed: number;
  remaining: number;
}

function emptySummary(reason: string): WeeklyDispatchSummary {
  return { ok: false, reason, totalDue: 0, sent: 0, skipped: 0, failed: 0, remaining: 0 };
}

/**
 * Serviço de agendamento: identifica os contratos semanais com disparo
 * previsto para hoje e processa a fila com segurança (healthcheck do
 * provedor, trava de horário, e re-checagem de status em tempo real antes
 * de cada mensagem). O delay randômico de 60-120s entre envios só é
 * aplicado ao Evolution API (automação não-oficial, com risco real de
 * banimento) — a Meta Cloud API é oficial e não precisa desse cuidado, então
 * a fila roda bem mais rápido quando esse é o provedor ativo.
 *
 * Multiusuário: cada usuário tem sua própria configuração de WhatsApp, então
 * a fila é agrupada por dono (`owner_id`) e processada um usuário de cada
 * vez, cada um com seu próprio healthcheck/provedor/delay — um usuário sem
 * WhatsApp configurado (ou com o provedor fora do ar) só tem os disparos
 * DELE pulados, nunca trava a fila dos demais.
 *
 * Processa em lote respeitando um orçamento de tempo (`maxDurationMs`),
 * já que o delay do Evolution API pode facilmente ultrapassar o limite de
 * execução de uma function serverless. O que não for processado nesta
 * chamada permanece pendente (proximo_disparo no passado) e é retomado
 * automaticamente na próxima execução do cron — o processamento é
 * idempotente e seguro para rodar em lotes.
 */
export async function runWeeklyDispatchQueue(
  supabase: SupabaseClient,
  options: { maxDurationMs?: number } = {},
): Promise<WeeklyDispatchSummary> {
  const startedAt = Date.now();
  const budgetMs = (options.maxDurationMs ?? DEFAULT_BUDGET_MS) - SAFETY_BUFFER_MS;

  if (!isWithinDispatchWindow()) {
    return emptySummary("Fora da janela de disparo (segunda a sexta, 09h-18h).");
  }

  const todayDateString = getBrazilDateString();
  const todayIsoWeekday = getBrazilIsoWeekday();

  const { data: dueCharges, error: dueError } = await supabase
    .from("weekly_charges")
    .select("id, owner_id")
    .eq("status", "PENDENTE")
    .eq("dia_semana_disparo", todayIsoWeekday)
    .lte("proximo_disparo", todayDateString)
    .order("proximo_disparo", { ascending: true });

  if (dueError) {
    return emptySummary(dueError.message);
  }

  const queue = dueCharges ?? [];
  if (queue.length === 0) {
    return { ok: true, totalDue: 0, sent: 0, skipped: 0, failed: 0, remaining: 0 };
  }

  const chargeIdsByOwner = new Map<string, string[]>();
  for (const charge of queue) {
    const list = chargeIdsByOwner.get(charge.owner_id) ?? [];
    list.push(charge.id);
    chargeIdsByOwner.set(charge.owner_id, list);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  ownerLoop: for (const [ownerId, chargeIds] of chargeIdsByOwner) {
    if (!isWithinDispatchWindow()) break; // janela fechou durante o processamento
    if (Date.now() - startedAt > budgetMs) break; // orçamento de tempo da invocação esgotado

    const { data: settings } = await supabase
      .from("message_settings")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("is_active", true)
      .maybeSingle();

    if (!settings || (settings.provider !== "evolution" && settings.provider !== "meta")) {
      // Esse usuário não tem WhatsApp configurado (ou usa um provedor sem
      // disparo automático) — pula só os disparos dele, sem travar os outros.
      skipped += chargeIds.length;
      continue;
    }

    const health =
      settings.provider === "evolution" ? await checkEvolutionConnection(settings) : await checkMetaConnection(settings);

    if (!health.ok) {
      skipped += chargeIds.length;
      continue;
    }

    for (const chargeId of chargeIds) {
      if (!isWithinDispatchWindow()) break ownerLoop;
      if (Date.now() - startedAt > budgetMs) break ownerLoop;

      processed += 1;
      const result = await dispatchWeeklyCharge(supabase, chargeId, settings);

      if (result.ok) sent += 1;
      else if (result.skippedReason) skipped += 1;
      else failed += 1;

      const isVeryLast = processed === queue.length;
      if (!isVeryLast) {
        await sleep(delayForProvider(settings.provider));
      }
    }
  }

  return {
    ok: true,
    totalDue: queue.length,
    sent,
    skipped,
    failed,
    remaining: queue.length - processed,
  };
}
