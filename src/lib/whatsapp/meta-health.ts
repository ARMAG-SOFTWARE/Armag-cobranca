import type { MessageSettings } from "@/lib/types";

export interface MetaHealthResult {
  ok: boolean;
  error?: string;
}

const META_GRAPH_API_VERSION = "v21.0";

/**
 * Verifica se o Phone Number ID + Access Token configurados são válidos
 * antes de iniciar a fila do dia. A Cloud API da Meta é stateless (chamadas
 * HTTPS avulsas, sem uma "sessão" que possa cair como no Evolution API) —
 * isto é uma checagem de credenciais, equivalente em espírito ao
 * healthcheck de conexão, mas não idêntica em mecanismo.
 */
export async function checkMetaConnection(settings: MessageSettings): Promise<MetaHealthResult> {
  if (settings.provider !== "meta") {
    return { ok: false, error: "Healthcheck disponível apenas para o provedor Meta Cloud API." };
  }

  const { api_key: accessToken, instance_id: phoneNumberId } = settings;
  if (!accessToken || !phoneNumberId) {
    return { ok: false, error: "Configuração da Meta Cloud API incompleta (Access Token, Phone Number ID)." };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        error: `Credenciais da Meta Cloud API inválidas (HTTP ${response.status}). ${body.slice(0, 200)}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erro ao verificar credenciais da Meta Cloud API.",
    };
  }
}
