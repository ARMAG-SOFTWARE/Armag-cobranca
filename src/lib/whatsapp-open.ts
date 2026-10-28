import type { WhatsAppOpenMode } from "@/lib/types";

export const WHATSAPP_OPEN_MODE_LABELS: Record<WhatsAppOpenMode, string> = {
  padrao: "Padrão do aparelho (wa.me)",
  business_android: "WhatsApp Business (Android)",
  web: "WhatsApp Web (navegador logado no Business)",
};

/**
 * Link que abre a conversa com o cliente, já com o texto preenchido. Um site
 * não consegue escolher a CONTA que envia — isso depende de qual aplicativo
 * abre o link no aparelho:
 *
 * - `padrao`: `wa.me`, o aparelho decide qual WhatsApp abre.
 * - `business_android`: intent do Android direcionada ao pacote do WhatsApp
 *   Business (`com.whatsapp.w4b`) — nunca abre o WhatsApp pessoal. Se o
 *   Business não estiver instalado, cai no `wa.me`.
 * - `web`: WhatsApp Web no navegador, que envia pela conta logada nele
 *   (útil no iPhone/iPad, onde não há como forçar o app Business).
 */
export function buildWhatsAppChatUrl(digits: string, text: string | undefined, mode: WhatsAppOpenMode): string {
  const encodedText = text ? encodeURIComponent(text) : "";
  const waMeUrl = `https://wa.me/${digits}${text ? `?text=${encodedText}` : ""}`;

  switch (mode) {
    case "business_android":
      return (
        `intent://send/?phone=${digits}${text ? `&text=${encodedText}` : ""}` +
        `#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(waMeUrl)};end`
      );
    case "web":
      return `https://web.whatsapp.com/send?phone=${digits}${text ? `&text=${encodedText}` : ""}`;
    default:
      return waMeUrl;
  }
}

/**
 * Abre o link de forma síncrona, na mesma interação de clique (qualquer
 * `await` antes faz o navegador tratar como pop-up). Uma intent do Android
 * precisa navegar na própria aba — `window.open` com intent não abre o app.
 */
export function openWhatsAppUrl(url: string) {
  if (url.startsWith("intent:")) {
    window.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
