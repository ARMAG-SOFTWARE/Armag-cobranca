import type { MessageSettings } from "@/lib/types";

export interface EvolutionHealthResult {
  ok: boolean;
  state?: string;
  error?: string;
}

/**
 * Verifica se a instância da Evolution API está com o status "open"
 * (conectada ao WhatsApp) antes de iniciar a fila de disparos do dia.
 * GET {base_url}/instance/connectionState/{instance_id}
 */
export async function checkEvolutionConnection(settings: MessageSettings): Promise<EvolutionHealthResult> {
  if (settings.provider !== "evolution") {
    return { ok: false, error: "Healthcheck disponível apenas para o provedor Evolution API." };
  }

  const { base_url, api_key, instance_id } = settings;
  if (!base_url || !api_key || !instance_id) {
    return { ok: false, error: "Configuração da Evolution API incompleta (base_url, api_key, instance_id)." };
  }

  try {
    const response = await fetch(
      `${base_url.replace(/\/$/, "")}/instance/connectionState/${instance_id}`,
      { headers: { apikey: api_key } },
    );

    if (!response.ok) {
      return { ok: false, error: `Healthcheck da Evolution API falhou (HTTP ${response.status}).` };
    }

    const data = await response.json();
    const state: string | undefined = data?.instance?.state ?? data?.state;

    if (state !== "open") {
      return { ok: false, state, error: `Instância da Evolution API não está conectada (estado: ${state ?? "desconhecido"}).` };
    }

    return { ok: true, state };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erro ao verificar conexão com a Evolution API.",
    };
  }
}
