import { addDays, addMonths, format, parseISO } from "date-fns";

import { daysBetweenDateStrings, getBusinessToday } from "@/lib/date-utils";
import type { Periodicity } from "@/lib/types";

export interface GeneratedInstallment {
  number: number;
  amount: number;
  due_date: string;
}

/** Cobrança diária: só de segunda a sábado — domingo nunca é dia de vencimento. */
function skipSunday(date: Date): Date {
  return date.getDay() === 0 ? addDays(date, 1) : date;
}

/** Avança `periods` dias de cobrança (segunda a sábado), partindo de `date` já sem domingo. */
function addChargeDays(date: Date, periods: number): Date {
  let result = skipSunday(date);
  for (let i = 0; i < periods; i++) {
    result = skipSunday(addDays(result, 1));
  }
  return result;
}

function addPeriod(date: Date, periodicity: Periodicity, periods: number) {
  switch (periodicity) {
    case "diaria":
      // Segunda a sábado (feriado conta); um 1º vencimento no domingo vai
      // para a segunda-feira seguinte.
      return addChargeDays(date, periods);
    case "semanal":
      return addDays(date, periods * 7);
    case "quinzenal":
      return addDays(date, periods * 15);
    case "mensal":
      return addMonths(date, periods);
  }
}

/**
 * 1º vencimento efetivo do contrato: na diária, um domingo passa para a
 * segunda-feira seguinte; nas demais periodicidades a data não muda.
 */
export function firstChargeDate(firstDueDate: string, periodicity: Periodicity): string {
  return format(addPeriod(parseISO(firstDueDate), periodicity, 0), "yyyy-MM-dd");
}

/** Um período (na periodicidade dada) depois de `dueDate` — ex.: renovação de parcela, correção de periodicidade. */
export function nextDueDate(dueDate: string, periodicity: Periodicity): string {
  return format(addPeriod(parseISO(dueDate), periodicity, 1), "yyyy-MM-dd");
}

export interface ScheduleInstallmentInput {
  number: number;
  due_date: string;
  /**
   * true quando a parcela já tem algum pagamento aplicado (total ou
   * parcial) — sua `due_date` nunca é tocada por `reflowSchedule`, igual a
   * qualquer outro dado histórico de pagamento já gravado.
   */
  locked: boolean;
}

/**
 * Recalcula as datas de vencimento das parcelas AINDA EM ABERTO (não
 * travadas) quando a periodicidade de um contrato é corrigida depois do
 * cadastro — sem nunca mexer na data (nem em nenhum outro campo) de uma
 * parcela que já tem pagamento aplicado, mesmo que parcial. Cada parcela
 * aberta é reencaixada um período (na NOVA periodicidade) depois da parcela
 * anterior — travada ou já recalculada nesta mesma passada —, continuando a
 * sequência de onde ela realmente está, nunca do zero. A primeira parcela,
 * se ainda estiver aberta, usa sempre `firstDueDate` (o 1º vencimento do
 * contrato, que nunca muda por causa da periodicidade).
 *
 * Função PURA — só calcula as novas datas; quem decide gravar ou não no
 * banco é sempre o chamador (`updateContractPeriodicity`, em actions.ts).
 */
export function reflowSchedule(
  installments: ScheduleInstallmentInput[],
  periodicity: Periodicity,
  firstDueDate: string,
): { number: number; due_date: string; changed: boolean }[] {
  const sorted = [...installments].sort((a, b) => a.number - b.number);
  const result: { number: number; due_date: string; changed: boolean }[] = [];
  let previousDueDate: string | null = null;

  for (const installment of sorted) {
    if (installment.locked) {
      result.push({ number: installment.number, due_date: installment.due_date, changed: false });
      previousDueDate = installment.due_date;
      continue;
    }

    const computedDueDate: string =
      previousDueDate === null ? firstChargeDate(firstDueDate, periodicity) : nextDueDate(previousDueDate, periodicity);

    result.push({
      number: installment.number,
      due_date: computedDueDate,
      changed: computedDueDate !== installment.due_date,
    });
    previousDueDate = computedDueDate;
  }

  return result;
}

/**
 * Divide o valor total em N parcelas com 2 casas decimais.
 * A última parcela absorve a diferença de arredondamento para que
 * a soma das parcelas seja sempre igual ao valor total.
 */
export function splitAmount(totalAmount: number, installmentsCount: number): number[] {
  const cents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(cents / installmentsCount);
  const remainder = cents - baseCents * installmentsCount;

  return Array.from({ length: installmentsCount }, (_, index) => {
    const extra = index === installmentsCount - 1 ? remainder : 0;
    return (baseCents + extra) / 100;
  });
}

export function generateInstallments(params: {
  totalAmount: number;
  installmentsCount: number;
  periodicity: Periodicity;
  firstDueDate: string;
}): GeneratedInstallment[] {
  const { totalAmount, installmentsCount, periodicity, firstDueDate } = params;
  const amounts = splitAmount(totalAmount, installmentsCount);
  const firstDate = parseISO(firstDueDate);

  return amounts.map((amount, index) => ({
    number: index + 1,
    amount,
    due_date: format(addPeriod(firstDate, periodicity, index), "yyyy-MM-dd"),
  }));
}

/** Dias corridos entre o 1º e o último vencimento de um parcelamento. */
export function installmentPlanSpanDays(params: {
  installmentsCount: number;
  periodicity: Periodicity;
  firstDueDate: string;
}): number {
  const firstDate = parseISO(firstChargeDate(params.firstDueDate, params.periodicity));
  const lastDate = addPeriod(firstDate, params.periodicity, Math.max(params.installmentsCount - 1, 0));
  return Math.round((lastDate.getTime() - firstDate.getTime()) / 86_400_000);
}

export function isOverdue(dueDate: string, referenceDate: Date = new Date()) {
  return daysBetweenDateStrings(dueDate, getBusinessToday(referenceDate)) > 0;
}
