/**
 * Utilitários de data no fuso horário do negócio (Brasil) — usados sempre
 * que o sistema precisa saber "qual é o dia de hoje" para decidir se uma
 * parcela vence hoje, está atrasada, ou para agrupar valores por dia/
 * semana/mês.
 *
 * Bug raiz que isto corrige: o servidor (Vercel) roda em UTC. `new
 * Date().toISOString()` SEMPRE converte para UTC, e os getters locais de
 * `Date` (`getFullYear`/`getMonth`/`getDate`) usam o fuso do PROCESSO node
 * (também UTC no servidor) — nenhum dos dois é o fuso do Brasil. Como
 * Brasília é UTC-3, entre 21h e meia-noite (horário de Brasília) o
 * calendário em UTC já virou o dia seguinte, então uma parcela que vence
 * amanhã podia aparecer como "vence hoje" (e o inverso). Toda comparação de
 * "hoje" no sistema deve passar por aqui, nunca por `toISOString()` ou por
 * getters locais de `Date` diretamente.
 */
const BUSINESS_TIMEZONE = "America/Sao_Paulo";
/** América/São_Paulo está fixo em UTC-3 desde o fim do horário de verão no Brasil (2019). */
const BUSINESS_UTC_OFFSET_HOURS = 3;

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" da data informada, no calendário do fuso do negócio. */
export function toBusinessDateString(date: Date): string {
  return businessDateFormatter.format(date);
}

/** "YYYY-MM-DD" de agora (ou de uma data de referência), no fuso do negócio. */
export function getBusinessToday(referenceDate: Date = new Date()): string {
  return toBusinessDateString(referenceDate);
}

function dateStringToUTCTimestamp(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Diferença em dias corridos entre duas datas "YYYY-MM-DD" (toDateStr − fromDateStr). */
export function daysBetweenDateStrings(fromDateStr: string, toDateStr: string): number {
  const diffMs = dateStringToUTCTimestamp(toDateStr) - dateStringToUTCTimestamp(fromDateStr);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Início do dia (00:00 no fuso do negócio) e início do dia seguinte, como
 * instantes UTC reais — para filtrar colunas timestamptz (ex.: `paid_at`)
 * por "hoje" sem depender do fuso do processo.
 */
export function businessDayRangeUTC(dateStr: string): { start: Date; end: Date } {
  const [year, month, day] = dateStr.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, BUSINESS_UTC_OFFSET_HOURS, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Início da semana (segunda-feira), no fuso do negócio, como instante UTC real. */
export function businessWeekStartUTC(referenceDate: Date = new Date()): Date {
  const todayStr = getBusinessToday(referenceDate);
  const { start: todayStart } = businessDayRangeUTC(todayStr);
  const isoWeekday = todayStart.getUTCDay() === 0 ? 7 : todayStart.getUTCDay(); // 1=segunda..7=domingo
  return new Date(todayStart.getTime() - (isoWeekday - 1) * 24 * 60 * 60 * 1000);
}

/** Início do mês, no fuso do negócio, como instante UTC real. */
export function businessMonthStartUTC(referenceDate: Date = new Date()): Date {
  const todayStr = getBusinessToday(referenceDate);
  const [year, month] = todayStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1, BUSINESS_UTC_OFFSET_HOURS, 0, 0, 0));
}
