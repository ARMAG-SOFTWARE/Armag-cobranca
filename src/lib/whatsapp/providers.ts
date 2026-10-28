import type { MessageSettings } from "@/lib/types";
import { onlyDigits } from "@/lib/utils";

export interface WhatsAppSendResult {
  ok: boolean;
  statusCode: number;
  body: unknown;
}

export interface WhatsAppMessagePayload {
  /** Texto final já renderizado (com variação/spintax aplicada) — usado pelos provedores de texto livre. */
  text: string;
  /**
   * Parâmetros ordenados [nome_cliente, numero_parcela, valor, data_vencimento],
   * mapeados para {{1}} {{2}} {{3}} {{4}} — usados apenas por provedores baseados
   * em template pré-aprovado (Meta Cloud API).
   */
  templateParams?: string[];
}

export interface WhatsAppProvider {
  send(toPhone: string, payload: WhatsAppMessagePayload): Promise<WhatsAppSendResult>;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Evolution API — https://doc.evolution-api.com
 * POST {base_url}/message/sendText/{instance_id}
 * header: apikey
 */
class EvolutionApiProvider implements WhatsAppProvider {
  constructor(private settings: MessageSettings) {}

  async send(toPhone: string, payload: WhatsAppMessagePayload): Promise<WhatsAppSendResult> {
    const { base_url, api_key, instance_id } = this.settings;
    if (!base_url || !api_key || !instance_id) {
      throw new Error("Configuração incompleta para Evolution API (base_url, api_key, instance_id).");
    }

    const response = await fetch(`${base_url.replace(/\/$/, "")}/message/sendText/${instance_id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: api_key,
      },
      body: JSON.stringify({
        number: onlyDigits(toPhone),
        text: payload.text,
      }),
    });

    return { ok: response.ok, statusCode: response.status, body: await parseResponse(response) };
  }
}

/**
 * Z-API — https://developer.z-api.io
 * POST {base_url}/instances/{instance_id}/token/{api_key}/send-text
 */
class ZApiProvider implements WhatsAppProvider {
  constructor(private settings: MessageSettings) {}

  async send(toPhone: string, payload: WhatsAppMessagePayload): Promise<WhatsAppSendResult> {
    const { base_url, api_key, instance_id } = this.settings;
    if (!base_url || !api_key || !instance_id) {
      throw new Error("Configuração incompleta para Z-API (base_url, api_key, instance_id).");
    }

    const url = `${base_url.replace(/\/$/, "")}/instances/${instance_id}/token/${api_key}/send-text`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: onlyDigits(toPhone),
        message: payload.text,
      }),
    });

    return { ok: response.ok, statusCode: response.status, body: await parseResponse(response) };
  }
}

/**
 * Twilio WhatsApp API — https://www.twilio.com/docs/whatsapp
 * POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
 * instance_id é usado como Account SID, auth_token como Auth Token.
 */
class TwilioProvider implements WhatsAppProvider {
  constructor(private settings: MessageSettings) {}

  async send(toPhone: string, payload: WhatsAppMessagePayload): Promise<WhatsAppSendResult> {
    const { instance_id: accountSid, auth_token: authToken, sender_number } = this.settings;
    if (!accountSid || !authToken || !sender_number) {
      throw new Error("Configuração incompleta para Twilio (Account SID, Auth Token, número remetente).");
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({
      From: `whatsapp:${sender_number}`,
      To: `whatsapp:+${onlyDigits(toPhone)}`,
      Body: payload.text,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body,
    });

    return { ok: response.ok, statusCode: response.status, body: await parseResponse(response) };
  }
}

/**
 * WPPConnect — https://wppconnect.io
 * POST {base_url}/api/{instance_id}/send-message
 * header: Authorization Bearer {api_key}
 */
class WppConnectProvider implements WhatsAppProvider {
  constructor(private settings: MessageSettings) {}

  async send(toPhone: string, payload: WhatsAppMessagePayload): Promise<WhatsAppSendResult> {
    const { base_url, api_key, instance_id } = this.settings;
    if (!base_url || !api_key || !instance_id) {
      throw new Error("Configuração incompleta para WPPConnect (base_url, api_key, instance_id/sessão).");
    }

    const url = `${base_url.replace(/\/$/, "")}/api/${instance_id}/send-message`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api_key}`,
      },
      body: JSON.stringify({
        phone: onlyDigits(toPhone),
        message: payload.text,
      }),
    });

    return { ok: response.ok, statusCode: response.status, body: await parseResponse(response) };
  }
}

const META_GRAPH_API_VERSION = "v21.0";

/**
 * Meta Cloud API (WhatsApp Business Platform) — https://developers.facebook.com/docs/whatsapp/cloud-api
 * POST https://graph.facebook.com/{version}/{phone_number_id}/messages
 * header: Authorization Bearer {access_token}
 *
 * Diferente dos demais provedores (que usam a automação não-oficial do
 * WhatsApp Web e por isso precisam de delay randômico/spintax para reduzir
 * risco de banimento), esta é a API oficial da Meta. Ela não corre esse
 * risco, mas em compensação só permite mensagens iniciadas pela empresa
 * através de um TEMPLATE pré-aprovado — texto livre não é aceito fora da
 * janela de 24h de atendimento. `instance_id` guarda o Phone Number ID e
 * `api_key` o Access Token (token de sistema, de longa duração).
 */
class MetaCloudApiProvider implements WhatsAppProvider {
  constructor(private settings: MessageSettings) {}

  async send(toPhone: string, payload: WhatsAppMessagePayload): Promise<WhatsAppSendResult> {
    const { api_key: accessToken, instance_id: phoneNumberId, template_name: templateName, template_language: templateLanguage } =
      this.settings;

    if (!accessToken || !phoneNumberId || !templateName) {
      throw new Error(
        "Configuração incompleta para Meta Cloud API (Access Token, Phone Number ID, nome do template aprovado).",
      );
    }

    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: onlyDigits(toPhone),
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage || "pt_BR" },
          components: [
            {
              type: "body",
              parameters: (payload.templateParams ?? []).map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
    });

    return { ok: response.ok, statusCode: response.status, body: await parseResponse(response) };
  }
}

export function createWhatsAppProvider(settings: MessageSettings): WhatsAppProvider {
  switch (settings.provider) {
    case "evolution":
      return new EvolutionApiProvider(settings);
    case "zapi":
      return new ZApiProvider(settings);
    case "twilio":
      return new TwilioProvider(settings);
    case "wppconnect":
      return new WppConnectProvider(settings);
    case "meta":
      return new MetaCloudApiProvider(settings);
    default:
      throw new Error(`Provedor de WhatsApp não suportado: ${settings.provider}`);
  }
}
