import { calculateLateInterest, daysLate, roundCents } from "@/lib/financial-rules";
import { getBusinessToday } from "@/lib/date-utils";
import { formatCurrency, formatDate, toWhatsAppDigits } from "@/lib/utils";
import type { Client, Contract, Installment } from "@/lib/types";

export type ReminderLinkResult = { ok: true; url: string } | { ok: false; error: string };

type ReminderContract = Pick<
  Contract,
  "type" | "principal_amount" | "installments_count" | "late_interest_rate_percent_per_day"
>;

type ReminderInstallment = Pick<
  Installment,
  "number" | "amount" | "due_date" | "status" | "paid_principal_amount" | "paid_interest_amount"
>;

/**
 * Monta o link `wa.me` com a mensagem de cobrança já preenchida para uma
 * parcela específica — nunca envia nada sozinho, só abre a conversa com o
 * texto pronto para o usuário conferir e enviar (ver `sendCollectionReminder`
 * em `@/lib/whatsapp` para o envio automático via API, usado por outro
 * fluxo, que continua existindo separadamente).
 *
 * Todos os valores vêm das mesmas funções usadas no resto do app
 * (`calculateLateInterest`) — nunca uma fórmula nova — e nunca cobra de
 * novo o que já foi pago: o "valor atualizado da parcela" final é sempre
 * o saldo realmente em aberto agora (principal pendente + juros de
 * atraso pendente, se houver). Tom firme e direto a pedido do usuário:
 * sem saudação ("bom dia" etc.), sem "tudo bem?"/"obrigado", direto na
 * situação da parcela — e "favor" em vez de "por favor" — só mostra
 * valor da parcela, dias de atraso, juros do dia e valor atualizado
 * (sem detalhar juros do contrato embutidos na parcela).
 */
export function buildWhatsAppReminderLink(
  client: Pick<Client, "phone">,
  contract: ReminderContract,
  installment: ReminderInstallment,
): ReminderLinkResult {
  const waDigits = toWhatsAppDigits(client.phone);
  if (!waDigits) {
    return {
      ok: false,
      error: "Telefone do cliente inválido ou incompleto. Corrija o cadastro antes de enviar o lembrete.",
    };
  }

  const outstandingPrincipal = roundCents(Math.max(installment.amount - installment.paid_principal_amount, 0));
  const lateInterestOwed = calculateLateInterest({
    lateInterestRatePercentPerDay: contract.late_interest_rate_percent_per_day,
    originalPrincipalAmount: contract.principal_amount,
    dueDate: installment.due_date,
    status: installment.status,
    paidInterestAmount: installment.paid_interest_amount,
  });
  const isOverdue = lateInterestOwed > 0;
  const totalDueNow = roundCents(outstandingPrincipal + lateInterestOwed);

  const situacao = isOverdue ? "em atraso" : "em aberto";
  const lines: string[] = [
    contract.installments_count > 1
      ? `Parcela ${installment.number}/${contract.installments_count} ${situacao}.`
      : `Pagamento ${situacao}.`,
    "",
  ];

  // Só os 4 campos pedidos pelo usuário (feedback de um devedor real:
  // "muita informação") — nunca detalha o juros do contrato embutido na
  // parcela, só o que importa pra quem vai pagar agora.
  lines.push(`Valor da parcela: ${formatCurrency(installment.amount)}`);

  if (isOverdue) {
    lines.push(`Dias de atraso: ${daysLate(installment.due_date)}`);
    lines.push(`Juros do dia: ${formatCurrency(lateInterestOwed)}`);
  }

  lines.push(`Data de vencimento: ${formatDate(installment.due_date)}`);
  lines.push(`Valor atualizado da parcela: ${formatCurrency(totalDueNow)}`);
  lines.push("", "Favor enviar o comprovante de pagamento.");

  const url = `https://wa.me/${waDigits}?text=${encodeURIComponent(lines.join("\n"))}`;
  return { ok: true, url };
}

/**
 * Uma linha já apurada de `getTodayDebtors` (src/lib/debtors.ts) — nunca
 * recalculada aqui. `outstandingPrincipal`/`interestOwed`/`totalDue` já
 * vêm prontos de `calculateLateInterest`/`roundCents`, a mesma apuração
 * usada em toda a tela "Devedores do Dia"; esta função só formata texto.
 */
export interface ConsolidatedReminderRow {
  contract: Pick<Contract, "installments_count">;
  installment: Pick<Installment, "number" | "due_date">;
  outstandingPrincipal: number;
  interestOwed: number;
  totalDue: number;
  daysLate: number;
  isOverdue: boolean;
}

/**
 * Monta o link `wa.me` com a cobrança CONSOLIDADA de um devedor — todas as
 * parcelas vencidas ainda não quitadas mais a parcela do dia, se houver —
 * para o botão "Cobrar pelo WhatsApp" de Devedores do Dia. Mesma regra do
 * lembrete de uma única parcela: nunca envia nada sozinho, nunca
 * recalcula juros (usa exatamente os valores já apurados pelo chamador),
 * e nunca grava nada no banco — quem abre e confirma o envio é sempre o
 * usuário. `rows` já vem filtrado e sem duplicidade por `getTodayDebtors`
 * (nunca uma parcela futura, paga, ou contada duas vezes), então o total
 * aqui é sempre a soma direta de `row.totalDue`, igual ao `Debtor.totalDue`
 * mostrado na tela — nunca um valor calculado em separado que possa
 * divergir do que o usuário já viu antes de clicar.
 */
export function buildConsolidatedWhatsAppReminderLink(debtor: {
  client: Pick<Client, "phone">;
  rows: ConsolidatedReminderRow[];
  totalDue: number;
}): ReminderLinkResult {
  const waDigits = toWhatsAppDigits(debtor.client.phone);
  if (!waDigits) {
    return {
      ok: false,
      error: "Telefone do cliente inválido ou incompleto. Corrija o cadastro antes de enviar o lembrete.",
    };
  }

  if (debtor.rows.length === 0) {
    return { ok: false, error: "Nenhuma parcela pendente para cobrar deste cliente." };
  }

  const lines: string[] = ["Situação de pagamento:", ""];

  for (const row of debtor.rows) {
    const parcela = `Parcela ${row.installment.number}/${row.contract.installments_count}`;
    if (row.isOverdue) {
      lines.push(
        `${parcela} vencida em ${formatDate(row.installment.due_date)} (${row.daysLate} dia${row.daysLate > 1 ? "s" : ""} de atraso): saldo ${formatCurrency(row.outstandingPrincipal)} + juros ${formatCurrency(row.interestOwed)} = ${formatCurrency(row.totalDue)}`,
      );
    } else {
      // Vence hoje, ainda não atrasada — nunca inclui juros aqui (regra:
      // juros de atraso só existe a partir do dia seguinte ao vencimento).
      lines.push(`${parcela} com vencimento hoje (${formatDate(row.installment.due_date)}): ${formatCurrency(row.totalDue)}`);
    }
  }

  lines.push("", `Total atualizado para pagamento: ${formatCurrency(debtor.totalDue)}`);
  lines.push(`Cálculo em ${formatDate(getBusinessToday())}.`);
  lines.push("", "Favor enviar o comprovante de pagamento.");

  const url = `https://wa.me/${waDigits}?text=${encodeURIComponent(lines.join("\n"))}`;
  return { ok: true, url };
}
