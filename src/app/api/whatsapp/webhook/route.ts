import { NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { timingSafeEqualStr } from "@/lib/constant-time";

export const dynamic = "force-dynamic";

/**
 * Webhook de ENTRADA da Evolution API (status de entrega das mensagens de
 * campanha). Esta rota roda SEM sessão de usuário, então toda a segurança é
 * explícita aqui:
 *
 *  1. Autenticação fail-closed: valida EVOLUTION_WEBHOOK_SECRET em tempo
 *     constante. Sem o segredo configurado, ou sem o header correto, responde
 *     401 ANTES de tocar o banco.
 *  2. Owner derivado server-side: o dono é resolvido pela INSTÂNCIA
 *     (message_settings.instance_id -> owner_id). O owner_id NUNCA vem do
 *     corpo do webhook — senão um webhook forjado escreveria em qualquer
 *     tenant.
 *  3. Idempotência: cada evento é gravado uma vez via unique(owner_id,
 *     provider_event_id); reentrega do provedor é tratada como duplicata.
 *  4. Limite de tamanho do corpo.
 *
 * IMPORTANTE (ver "Limitações conhecidas" no checklist): os nomes EXATOS dos
 * campos do payload da Evolution v2 precisam ser confirmados contra uma
 * instância real. O parsing está isolado em `parseEvolutionEvent` justamente
 * para ser ajustado num único lugar.
 */

const MAX_BODY_BYTES = 256 * 1024;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return false; // fail-closed: sem segredo configurado, nega tudo
  const headerSecret =
    request.headers.get("x-webhook-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return timingSafeEqualStr(headerSecret, secret);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

interface ParsedEvent {
  instance: string | null;
  providerEventId: string | null;
  eventType: string;
  providerMessageId: string | null;
  deliveryStatus: string | null;
}

// AJUSTAR os caminhos conforme o payload real da Evolution v2.
function parseEvolutionEvent(body: unknown): ParsedEvent {
  const root = asRecord(body);
  const data = asRecord(root.data);
  const key = asRecord(data.key);

  const instance = asString(root.instance) ?? asString(root.instanceId);
  const eventType = asString(root.event) ?? asString(root.type) ?? "unknown";
  const providerMessageId = asString(key.id) ?? asString(data.id) ?? asString(data.messageId);
  const deliveryStatus = asString(data.status) ?? asString(root.status);

  // provider_event_id: usa um id de evento explícito quando houver; senão
  // deriva um estável (mensagem + status) para a idempotência funcionar
  // mesmo quando o provedor não manda um id de evento próprio.
  const explicitEventId = asString(root.eventId) ?? asString(root.id);
  const providerEventId =
    explicitEventId ?? (providerMessageId ? `${providerMessageId}:${deliveryStatus ?? eventType}` : null);

  return { instance, providerEventId, eventType, providerMessageId, deliveryStatus };
}

// Mapeia o status de entrega da Evolution para o enum de
// whatsapp_campaign_messages.status. Desconhecido => não atualiza.
function mapDeliveryStatus(raw: string): string | null {
  switch (raw.toUpperCase()) {
    case "PENDING":
      return "processando";
    case "SERVER_ACK":
    case "SENT":
      return "enviada";
    case "DELIVERY_ACK":
    case "DELIVERED":
    case "READ":
      return "entregue";
    case "ERROR":
    case "FAILED":
      return "falha";
    default:
      return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload muito grande." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const event = parseEvolutionEvent(body);
  if (!event.instance || !event.providerEventId) {
    // Sem instância ou sem id de evento não há como atribuir/idempotizar.
    return NextResponse.json({ ignored: true }, { status: 202 });
  }

  const supabase = createServiceRoleClient();

  // Deriva o owner pela instância — NUNCA confia em owner vindo do payload.
  const { data: settings, error: settingsError } = await supabase
    .from("message_settings")
    .select("owner_id")
    .eq("instance_id", event.instance)
    .eq("is_active", true)
    .maybeSingle();

  if (settingsError || !settings?.owner_id) {
    // Instância desconhecida: ignora silenciosamente (não vaza se existe ou não).
    return NextResponse.json({ ignored: true }, { status: 202 });
  }
  const ownerId: string = settings.owner_id;

  // Idempotência: grava o evento; colisão no unique(owner_id, provider_event_id)
  // significa que já foi processado.
  const { error: insertError } = await supabase.from("whatsapp_webhook_events").insert({
    owner_id: ownerId,
    provider_event_id: event.providerEventId,
    event_type: event.eventType,
    payload: body,
    processed_at: new Date().toISOString(),
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ duplicate: true });
    }
    // Erro genérico — nunca repassa detalhe cru do Postgres.
    console.error("[whatsapp/webhook] erro ao gravar evento —", insertError.message);
    return NextResponse.json({ error: "Erro ao processar evento." }, { status: 500 });
  }

  // Atualiza o status da mensagem de campanha correspondente (escopo do owner).
  if (event.providerMessageId && event.deliveryStatus) {
    const mapped = mapDeliveryStatus(event.deliveryStatus);
    if (mapped) {
      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> = { status: mapped };
      if (mapped === "entregue") patch.delivered_at = nowIso;
      if (mapped === "enviada" || mapped === "aceita") patch.confirmed_at = nowIso;

      await supabase
        .from("whatsapp_campaign_messages")
        .update(patch)
        .eq("owner_id", ownerId)
        .eq("provider_message_id", event.providerMessageId);
    }
  }

  return NextResponse.json({ ok: true });
}
