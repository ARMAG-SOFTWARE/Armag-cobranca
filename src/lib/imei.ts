/**
 * Formato de IMEI aceito pelo app: exatamente 15 dígitos numéricos. Sempre
 * tratado como texto (nunca convertido para `number`) — converter perderia
 * zeros à esquerda, que são parte válida e significativa do identificador.
 */
export const IMEI_PATTERN = /^\d{15}$/;

/** Remove espaços no início/fim; nunca mexe no conteúdo interno do valor. */
export function normalizeImei(value: string): string {
  return value.trim();
}

export function isValidImei(value: string): boolean {
  return IMEI_PATTERN.test(normalizeImei(value));
}
