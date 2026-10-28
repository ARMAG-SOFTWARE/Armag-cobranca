import { toBusinessDateString } from "@/lib/date-utils";

/**
 * Trava de horário do disparo automático de cobranças: segunda a sexta,
 * das 09:00 às 18:00, no horário de Brasília. Calculado via Intl a partir
 * do relógio real (não depende do fuso horário do servidor/runtime).
 *
 * O fuso horário do negócio é definido uma única vez em `@/lib/date-utils`
 * — não duplicar a constante aqui, para nunca haver duas fontes de verdade
 * sobre "qual é o fuso do negócio" divergindo entre si.
 */
const TIMEZONE = "America/Sao_Paulo";

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function getBrazilDateInfo(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";

  return {
    isoWeekday: WEEKDAY_TO_ISO[weekdayShort] ?? 1,
    hour: Number(hourStr) % 24,
  };
}

/** Dia da semana (ISO 8601: 1=segunda ... 7=domingo) no horário de Brasília. */
export function getBrazilIsoWeekday(date: Date = new Date()): number {
  return getBrazilDateInfo(date).isoWeekday;
}

/** Data (yyyy-MM-dd) no horário de Brasília, para comparar com colunas `date`. */
export function getBrazilDateString(date: Date = new Date()): string {
  return toBusinessDateString(date);
}

/** true se estamos entre segunda e sexta, das 09:00 (inclusive) às 18:00 (exclusive), em Brasília. */
export function isWithinDispatchWindow(date: Date = new Date()): boolean {
  const { isoWeekday, hour } = getBrazilDateInfo(date);
  const isBusinessDay = isoWeekday >= 1 && isoWeekday <= 5;
  const isBusinessHour = hour >= 9 && hour < 18;
  return isBusinessDay && isBusinessHour;
}
