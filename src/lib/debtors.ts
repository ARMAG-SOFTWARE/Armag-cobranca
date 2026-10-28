import { businessDayRangeUTC, getBusinessToday } from "@/lib/date-utils";
import { calculateLateInterest, daysLate, roundCents } from "@/lib/financial-rules";
import type { createClient } from "@/lib/supabase/server";
import type { Client, Contract, Installment } from "@/lib/types";

export interface DebtorInstallmentRow {
  installment: Installment;
  contract: Pick<Contract, "id" | "type" | "description" | "installments_count" | "principal_amount">;
  outstandingPrincipal: number;
  interestOwed: number;
  totalDue: number;
  daysLate: number;
  isOverdue: boolean;
  isDueToday: boolean;
}

export interface Debtor {
  client: Client;
  rows: DebtorInstallmentRow[];
  totalDue: number;
  hasOverdue: boolean;
  hasDueToday: boolean;
  maxDaysLate: number;
}

export interface TodayDebtorsSummary {
  debtorsCount: number;
  installmentsCount: number;
  expectedAmount: number;
  lateInterestAmount: number;
  totalToReceive: number;
  paidTodayCount: number;
  receivedToday: number;
}

export interface LateInterestDetailRow {
  clientId: string;
  clientName: string;
  contractId: string;
  installmentNumber: number;
  installmentsCount: number;
  dueDate: string;
  daysLate: number;
  /** Valor originalmente emprestado no contrato — base do juros de atraso. */
  originalPrincipalAmount: number;
  interestOwed: number;
}

/**
 * Detalhamento de exatamente quais clientes/parcelas compõem o total de
 * juros de atraso pendentes mostrado no dashboard — a soma deste
 * detalhamento é SEMPRE igual ao valor do card, porque os dois vêm do
 * mesmo `debtors` (nunca calculados de formas diferentes em telas
 * diferentes).
 */
export function getLateInterestBreakdown(debtors: Debtor[]): LateInterestDetailRow[] {
  const rows: LateInterestDetailRow[] = [];

  for (const debtor of debtors) {
    for (const row of debtor.rows) {
      if (!row.isOverdue || row.interestOwed <= 0) continue;
      rows.push({
        clientId: debtor.client.id,
        clientName: debtor.client.name,
        contractId: row.contract.id,
        installmentNumber: row.installment.number,
        installmentsCount: row.contract.installments_count,
        dueDate: row.installment.due_date,
        daysLate: row.daysLate,
        originalPrincipalAmount: row.contract.principal_amount,
        interestOwed: row.interestOwed,
      });
    }
  }

  rows.sort((a, b) => b.interestOwed - a.interestOwed);
  return rows;
}

export interface PaidTodayRow {
  clientName: string;
  installmentNumber: number | null;
  totalInstallments: number | null;
  amount: number;
  method: string;
  paidAt: string;
  createdByEmail: string | null;
}

/**
 * Devedores do dia: todas as parcelas com vencimento hoje OU já vencidas
 * (atrasadas) que ainda não estão totalmente pagas, agrupadas por cliente.
 * Reaproveita `calculateLateInterest` (mesma função usada em toda a
 * aplicação) para nunca duplicar/divergir o juros de atraso — cada parcela
 * calcula o seu próprio juros a partir da sua própria due_date, então
 * parcelas diferentes do mesmo cliente nunca se misturam.
 */
export async function getTodayDebtors(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ debtors: Debtor[]; summary: TodayDebtorsSummary; paidToday: PaidTodayRow[] }> {
  const now = new Date();
  const todayStr = getBusinessToday(now);
  const { start: dayStart, end: dayEnd } = businessDayRangeUTC(todayStr);

  const [{ data: installmentsData }, { data: paymentsTodayData }] = await Promise.all([
    supabase
      .from("installments")
      .select(
        "*, contract:contracts(id, type, status, description, installments_count, principal_amount, client:clients(*))",
      )
      .in("status", ["pendente", "atrasado", "parcial"])
      .lte("due_date", todayStr),
    supabase
      .from("payments")
      .select(
        "installment_id, principal_amount, interest_amount, method, paid_at, created_by_email, installment:installments(number, status, contract:contracts(installments_count)), client:clients(name)",
      )
      .not("installment_id", "is", null)
      .gte("paid_at", dayStart.toISOString())
      .lt("paid_at", dayEnd.toISOString())
      .order("paid_at", { ascending: false }),
  ]);

  type InstallmentRow = Installment & {
    contract: Pick<Contract, "id" | "type" | "status" | "description" | "installments_count" | "principal_amount"> & {
      client: Client;
    };
  };
  const allInstallments = (installmentsData ?? []) as InstallmentRow[];
  // Um empréstimo cancelado (ex.: cadastrado errado e excluído) nunca deve
  // continuar cobrando o cliente nem aparecer nos indicadores.
  const installments = allInstallments.filter((installment) => installment.contract.status !== "cancelado");

  const debtorsByClient = new Map<string, Debtor>();

  let expectedAmount = 0;
  let lateInterestAmount = 0;

  for (const installment of installments) {
    const outstandingPrincipal = roundCents(
      Math.max(installment.amount - installment.paid_principal_amount, 0),
    );
    if (outstandingPrincipal <= 0) continue;

    const interestOwed = calculateLateInterest({
      contractType: installment.contract.type,
      originalPrincipalAmount: installment.contract.principal_amount,
      dueDate: installment.due_date,
      status: installment.status,
      paidInterestAmount: installment.paid_interest_amount,
    });
    const late = daysLate(installment.due_date, now);
    const isOverdue = late > 0;
    const isDueToday = installment.due_date === todayStr;
    const totalDue = roundCents(outstandingPrincipal + interestOwed);

    expectedAmount = roundCents(expectedAmount + outstandingPrincipal);
    lateInterestAmount = roundCents(lateInterestAmount + interestOwed);

    const client = installment.contract.client;
    const row: DebtorInstallmentRow = {
      installment,
      contract: installment.contract,
      outstandingPrincipal,
      interestOwed,
      totalDue,
      daysLate: late,
      isOverdue,
      isDueToday,
    };

    const existing = debtorsByClient.get(client.id);
    if (existing) {
      existing.rows.push(row);
      existing.totalDue = roundCents(existing.totalDue + totalDue);
      existing.hasOverdue = existing.hasOverdue || isOverdue;
      existing.hasDueToday = existing.hasDueToday || isDueToday;
      existing.maxDaysLate = Math.max(existing.maxDaysLate, late);
    } else {
      debtorsByClient.set(client.id, {
        client,
        rows: [row],
        totalDue,
        hasOverdue: isOverdue,
        hasDueToday: isDueToday,
        maxDaysLate: late,
      });
    }
  }

  const debtors = Array.from(debtorsByClient.values());
  for (const debtor of debtors) {
    debtor.rows.sort((a, b) => b.daysLate - a.daysLate);
  }
  // Prioridade: atrasados primeiro, depois vence hoje, depois maior valor pendente.
  debtors.sort((a, b) => {
    if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;
    if (a.hasDueToday !== b.hasDueToday) return a.hasDueToday ? -1 : 1;
    return b.totalDue - a.totalDue;
  });

  type PaymentTodayRow = {
    installment_id: string;
    principal_amount: number;
    interest_amount: number;
    method: string;
    paid_at: string;
    created_by_email: string | null;
    client: { name: string } | null;
    installment: { number: number; status: string; contract: { installments_count: number } | null } | null;
  };
  const paymentsToday = (paymentsTodayData ?? []) as unknown as PaymentTodayRow[];

  const paidToday: PaidTodayRow[] = paymentsToday.map((payment) => ({
    clientName: payment.client?.name ?? "—",
    installmentNumber: payment.installment?.number ?? null,
    totalInstallments: payment.installment?.contract?.installments_count ?? null,
    amount: roundCents(payment.principal_amount + payment.interest_amount),
    method: payment.method,
    paidAt: payment.paid_at,
    createdByEmail: payment.created_by_email,
  }));

  const fullyPaidInstallmentIdsToday = new Set(
    paymentsToday.filter((p) => p.installment?.status === "pago").map((p) => p.installment_id),
  );
  const receivedToday = roundCents(
    paymentsToday.reduce((sum, p) => sum + p.principal_amount + p.interest_amount, 0),
  );

  const summary: TodayDebtorsSummary = {
    debtorsCount: debtors.length,
    installmentsCount: installments.filter(
      (i) => roundCents(Math.max(i.amount - i.paid_principal_amount, 0)) > 0,
    ).length,
    expectedAmount,
    lateInterestAmount,
    totalToReceive: roundCents(expectedAmount + lateInterestAmount),
    paidTodayCount: fullyPaidInstallmentIdsToday.size,
    receivedToday,
  };

  return { debtors, summary, paidToday };
}
