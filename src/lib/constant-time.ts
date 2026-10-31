import { timingSafeEqual } from "node:crypto";

/**
 * Comparação de strings em tempo constante — para segredos/tokens, nunca com
 * `===` (que faz curto-circuito no primeiro byte diferente e abre um canal de
 * timing). A diferença de COMPRIMENTO é inevitavelmente observável (o
 * timingSafeEqual exige buffers do mesmo tamanho), mas o conteúdo de segredos
 * do mesmo tamanho nunca vaza por tempo.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
