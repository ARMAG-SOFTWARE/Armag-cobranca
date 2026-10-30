import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isAllowedProviderBaseUrl, isPrivateOrReservedIp } from "@/lib/validations";

/**
 * `fetch` endurecido para chamar a API de WhatsApp de um provedor cujo
 * `base_url` é configurado pelo usuário. Fecha o risco residual de SSRF que a
 * validação de entrada (`isAllowedProviderBaseUrl`, em validations.ts) sozinha
 * não cobre:
 *
 *  1. **DNS rebinding:** a validação de entrada olha só a STRING do host. Um
 *     domínio público (`evil.exemplo.com`) pode resolver para um IP interno
 *     (ex.: 169.254.169.254). Aqui resolvemos o host e validamos TODOS os IPs
 *     retornados antes de conectar.
 *  2. **Redirect para alvo interno:** por padrão o `fetch` segue 3xx, o que
 *     permitiria um host público redirecionar para um endereço interno depois
 *     da checagem. Usamos `redirect: "manual"` e tratamos qualquer 3xx como
 *     bloqueio.
 *  3. **Pendurar a requisição:** timeout via AbortController.
 *
 * Limitação conhecida (documentada de propósito): entre a resolução de DNS
 * aqui e a conexão real do `fetch` há uma janela TOCTOU — um atacante com
 * controle total sobre um servidor de DNS malicioso e TTL zero ainda poderia,
 * em tese, devolver um IP público na checagem e um interno na conexão. Fechar
 * isso 100% exige pinar o IP validado no socket (dispatcher undici com
 * `connect.lookup` fixo). Para o modelo de ameaça atual (usuário autenticado
 * configurando o próprio gateway), as três defesas acima reduzem o risco de
 * forma significativa; o pin de socket fica como melhoria futura.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export async function safeProviderFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // Defesa 1 (entrada): rejeita protocolo/host inválido ou IP interno literal.
  if (!isAllowedProviderBaseUrl(url)) {
    throw new Error("URL do provedor não permitida (protocolo inválido ou endereço interno).");
  }

  const bareHost = new URL(url).hostname.replace(/^\[|\]$/g, "");

  // Defesa 2 (saída): valida o IP efetivamente resolvido (anti DNS rebinding).
  if (isIP(bareHost)) {
    if (isPrivateOrReservedIp(bareHost)) {
      throw new Error("Destino resolve para um IP interno/reservado.");
    }
  } else {
    const resolved = await lookup(bareHost, { all: true });
    if (resolved.length === 0) {
      throw new Error("Não foi possível resolver o host do provedor.");
    }
    for (const { address } of resolved) {
      if (isPrivateOrReservedIp(address)) {
        throw new Error("O host do provedor resolve para um IP interno/reservado.");
      }
    }
  }

  // Defesa 3: timeout + nunca seguir redirect (um 3xx poderia apontar para
  // um endereço interno, burlando a checagem acima).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
    // undici (Node) devolve o 3xx cru; runtimes estilo browser devolvem
    // `type: "opaqueredirect"` com status 0. Ambos são bloqueados.
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new Error("O provedor respondeu com um redirecionamento — bloqueado por segurança (anti-SSRF).");
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}
