import { addDays, addMonths, format, parseISO } from "date-fns";

import { daysBetweenDateStrings, getBusinessToday } from "@/lib/date-utils";
import type { Periodicity } from "@/lib/types";

export interface GeneratedInstallment {
  number: number;
  amount: number;
  due_date: string;
}

function addPeriod(date: Date, periodicity: Periodicity, periods: number) {
  switch (periodicity) {
    case "semanal":
      return addDays(date, periods * 7);
    case "quinzenal":
      return addDays(date, periods * 15);
    case "mensal":
      return addMonths(date, periods);
  }
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

export function isOverdue(dueDate: string, referenceDate: Date = new Date()) {
  return daysBetweenDateStrings(dueDate, getBusinessToday(referenceDate)) > 0;
}
