import { calculateLateInterest, daysLate, roundCents } from "@/lib/financial-rules";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Client, Contract, Installment } from "@/lib/types";

/**
 * `{dias_atraso}`, `{juros_dia}` e `{valor_atualizado}` usam a mesma
 * `calculateLateInterest` de `financial-rules.ts` — nunca uma fórmula
 * nova — para ficar alinhado com o padrão enxuto adotado no lembrete
 * manual (`buildWhatsAppReminderLink`). Como este motor só faz
 * substituição literal de texto (sem condicional), esses dois campos
 * aparecem sempre, mesmo quando a parcela ainda não está atrasada (nesse
 * caso saem como "0"/"R$ 0,00") — diferente do lembrete manual, que
 * omite as linhas inteiras quando não há atraso. Isso só é visível na
 * prática se um disparo automático ocorrer no próprio dia do vencimento
 * (ex.: 1º disparo semanal); o cron diário só dispara para parcela já
 * marcada "atrasado", então sempre tem dias/juros reais ali.
 */
export function renderReminderMessage(
  template: string,
  client: Pick<Client, "name">,
  contract: Pick<Contract, "type" | "principal_amount" | "late_interest_rate_percent_per_day">,
  installment: Pick<
    Installment,
    "number" | "amount" | "due_date" | "status" | "paid_principal_amount" | "paid_interest_amount"
  >,
  installmentsCount: number,
) {
  const outstandingPrincipal = roundCents(Math.max(installment.amount - installment.paid_principal_amount, 0));
  const lateInterestOwed = calculateLateInterest({
    lateInterestRatePercentPerDay: contract.late_interest_rate_percent_per_day,
    originalPrincipalAmount: contract.principal_amount,
    dueDate: installment.due_date,
    status: installment.status,
    paidInterestAmount: installment.paid_interest_amount,
  });
  const totalDueNow = roundCents(outstandingPrincipal + lateInterestOwed);

  return template
    .replaceAll("{nome_cliente}", client.name)
    .replaceAll("{numero_parcela}", `${installment.number}/${installmentsCount}`)
    .replaceAll("{valor}", formatCurrency(installment.amount).replace("R$", "").trim())
    .replaceAll("{data_vencimento}", formatDate(installment.due_date))
    .replaceAll("{dias_atraso}", String(daysLate(installment.due_date)))
    .replaceAll("{juros_dia}", formatCurrency(lateInterestOwed).replace("R$", "").trim())
    .replaceAll("{valor_atualizado}", formatCurrency(totalDueNow).replace("R$", "").trim());
}

/**
 * Mesmos valores de `renderReminderMessage`, mas como array ordenado
 * (nome_cliente, numero_parcela, valor, data_vencimento) — para provedores
 * baseados em template pré-aprovado (Meta Cloud API), onde cada posição
 * mapeia para uma variável {{1}} {{2}} {{3}} {{4}} do template.
 */
export function buildReminderTemplateParams(
  client: Pick<Client, "name">,
  installment: Pick<Installment, "number" | "amount" | "due_date">,
  installmentsCount: number,
): string[] {
  return [
    client.name,
    `${installment.number}/${installmentsCount}`,
    formatCurrency(installment.amount).replace("R$", "").trim(),
    formatDate(installment.due_date),
  ];
}
