/**
 * Resolve blocos de spintax no formato {opção 1|opção 2|opção 3},
 * escolhendo uma opção aleatória. Suporta blocos aninhados.
 */
export function resolveSpintax(text: string): string {
  const pattern = /\{([^{}]+)\}/;
  let result = text;

  while (pattern.test(result)) {
    result = result.replace(pattern, (_match, options: string) => {
      const choices = options.split("|");
      return choices[Math.floor(Math.random() * choices.length)];
    });
  }

  return result;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Tom firme e direto (padrão pedido pelo usuário, sem saudação nem
// fórmulas de cortesia) — a variação entre frases serve só para reduzir
// a chance de mensagens idênticas em sequência (anti-ban), nunca para
// suavizar o conteúdo.
const CLOSINGS = [
  "Favor regularizar o pagamento.",
  "Regularize o quanto antes para evitar mais encargos.",
  "Envie o comprovante após o pagamento.",
];

export function pickClosing(): string {
  return pickRandom(CLOSINGS);
}

/**
 * Monta uma variação da mensagem final: corpo (com spintax já resolvido)
 * + frase de encerramento aleatória, sem saudação. Reduz a chance de
 * mensagens idênticas serem enviadas em sequência para o WhatsApp.
 */
export function varyMessage(core: string): string {
  const resolvedCore = resolveSpintax(core);
  const closing = pickClosing();

  return `${resolvedCore}\n\n${closing}`;
}
