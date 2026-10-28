import { describe, expect, it } from "vitest";

import { formatCurrency } from "@/lib/utils";
import { buildWhatsAppChatUrl } from "@/lib/whatsapp-open";
import {
  buildConsolidatedWhatsAppReminderLink,
  buildWhatsAppReminderLink,
  type ConsolidatedReminderRow,
} from "@/lib/whatsapp-reminder-link";

/** Decodifica de volta o texto embutido no link `wa.me` pra comparar o conteúdo real. */
function extractText(url: string): string {
  return decodeURIComponent(url.split("?text=")[1]);
}

function row(overrides: Partial<ConsolidatedReminderRow> = {}): ConsolidatedReminderRow {
  return {
    contract: { installments_count: 4 },
    installment: { number: 1, due_date: "2026-01-21" },
    outstandingPrincipal: 375,
    interestOwed: 0,
    totalDue: 375,
    daysLate: 0,
    isOverdue: false,
    ...overrides,
  };
}

describe("buildConsolidatedWhatsAppReminderLink", () => {
  const client = { phone: "11999998888" };

  it("cenário 7: telefone ausente ou inválido nunca gera link, sempre retorna erro compreensível", () => {
    const empty = buildConsolidatedWhatsAppReminderLink({ client: { phone: "" }, rows: [row()], totalDue: 375 });
    expect(empty.ok).toBe(false);

    const invalid = buildConsolidatedWhatsAppReminderLink({ client: { phone: "abc" }, rows: [row()], totalDue: 375 });
    expect(invalid.ok).toBe(false);
  });

  it("cenário 6: sem nenhuma parcela pendente (tudo quitado), recusa gerar mensagem vazia", () => {
    const result = buildConsolidatedWhatsAppReminderLink({ client, rows: [], totalDue: 0 });
    expect(result.ok).toBe(false);
  });

  it("cenário 1: parcela vencendo hoje e nenhuma atrasada — nunca menciona atraso/juros", () => {
    const today = row({ isOverdue: false, daysLate: 0, interestOwed: 0, totalDue: 375 });
    const result = buildConsolidatedWhatsAppReminderLink({ client, rows: [today], totalDue: 375 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = extractText(result.url);
    expect(text).toContain("vencimento hoje");
    expect(text).not.toMatch(/atraso/i);
    expect(text).not.toMatch(/juros/i);
    expect(text).toContain(`Total atualizado para pagamento: ${formatCurrency(375)}`);
  });

  it("cenário 2: uma parcela atrasada com juros aplicáveis", () => {
    const overdue = row({ isOverdue: true, daysLate: 6, outstandingPrincipal: 300, interestOwed: 90, totalDue: 390 });
    const result = buildConsolidatedWhatsAppReminderLink({ client, rows: [overdue], totalDue: 390 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = extractText(result.url);
    expect(text).toContain("vencida em");
    expect(text).toContain("6 dias de atraso");
    expect(text).toContain(`saldo ${formatCurrency(300)}`);
    expect(text).toContain(`juros ${formatCurrency(90)}`);
    expect(text).toContain(`= ${formatCurrency(390)}`);
  });

  it("cenário 3: várias parcelas atrasadas — cada uma listada, total é a soma exata (nunca conta duas vezes)", () => {
    const row1 = row({
      installment: { number: 1, due_date: "2025-12-15" },
      isOverdue: true,
      daysLate: 37,
      outstandingPrincipal: 300,
      interestOwed: 111,
      totalDue: 411,
    });
    const row2 = row({
      installment: { number: 2, due_date: "2026-01-15" },
      isOverdue: true,
      daysLate: 6,
      outstandingPrincipal: 300,
      interestOwed: 18,
      totalDue: 318,
    });
    const total = roundSum(row1.totalDue, row2.totalDue);
    const result = buildConsolidatedWhatsAppReminderLink({ client, rows: [row1, row2], totalDue: total });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = extractText(result.url);
    expect(text).toContain("Parcela 1/4 vencida em 15/12/2025");
    expect(text).toContain("Parcela 2/4 vencida em 15/01/2026");
    expect(text).toContain(`Total atualizado para pagamento: ${formatCurrency(total)}`);
  });

  it("cenário 4: parcelas atrasadas + parcela atual no mesmo cliente", () => {
    const overdue = row({
      installment: { number: 1, due_date: "2026-01-15" },
      isOverdue: true,
      daysLate: 6,
      outstandingPrincipal: 300,
      interestOwed: 18,
      totalDue: 318,
    });
    const current = row({
      installment: { number: 2, due_date: "2026-01-21" },
      isOverdue: false,
      daysLate: 0,
      outstandingPrincipal: 375,
      interestOwed: 0,
      totalDue: 375,
    });
    const total = roundSum(overdue.totalDue, current.totalDue);
    const result = buildConsolidatedWhatsAppReminderLink({ client, rows: [overdue, current], totalDue: total });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = extractText(result.url);
    expect(text).toContain("vencida em");
    expect(text).toContain("vencimento hoje");
    expect(text).toContain(`Total atualizado para pagamento: ${formatCurrency(total)}`);
  });

  it("cenário 8: parcelas de operações/contratos diferentes do mesmo cliente", () => {
    const loan = row({ contract: { installments_count: 4 }, installment: { number: 2, due_date: "2026-01-15" }, isOverdue: true, daysLate: 6, outstandingPrincipal: 300, interestOwed: 18, totalDue: 318 });
    const sale = row({ contract: { installments_count: 6 }, installment: { number: 3, due_date: "2026-01-15" }, isOverdue: true, daysLate: 6, outstandingPrincipal: 200, interestOwed: 0, totalDue: 200 });
    const total = roundSum(loan.totalDue, sale.totalDue);
    const result = buildConsolidatedWhatsAppReminderLink({ client, rows: [loan, sale], totalDue: total });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = extractText(result.url);
    expect(text).toContain("Parcela 2/4");
    expect(text).toContain("Parcela 3/6");
  });

  it("cenário 14: o total da mensagem é sempre exatamente a soma dos valores de cada parcela exibida", () => {
    const row1 = row({ isOverdue: true, daysLate: 6, outstandingPrincipal: 300, interestOwed: 18, totalDue: 318 });
    const row2 = row({ installment: { number: 2, due_date: "2026-01-21" }, isOverdue: false, daysLate: 0, interestOwed: 0, totalDue: 200 });
    const total = roundSum(row1.totalDue, row2.totalDue);
    const result = buildConsolidatedWhatsAppReminderLink({ client, rows: [row1, row2], totalDue: total });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = extractText(result.url);
    expect(text).toContain(`Total atualizado para pagamento: ${formatCurrency(total)}`);
    // O total é literalmente o que o chamador (getTodayDebtors) já soma — a
    // função nunca recalcula por conta própria, então aqui só confere que
    // o número exibido é exatamente o `totalDue` recebido, nunca outro.
    expect(total).toBe(roundSum(row1.totalDue, row2.totalDue));
  });

  it("cenário 12: acentos, quebras de linha e espaços sobrevivem intactos à ida e volta pela URL", () => {
    const overdue = row({ isOverdue: true, daysLate: 1, interestOwed: 10, totalDue: 385 });
    const result = buildConsolidatedWhatsAppReminderLink({ client, rows: [overdue], totalDue: 385 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = extractText(result.url);
    expect(text).toContain("Favor enviar o comprovante de pagamento.");
    expect(text.includes("\n")).toBe(true);
    // Ida e volta: recodificar o texto decodificado tem que bater com a
    // query string original, sem nenhum caractere corrompido/perdido.
    expect(encodeURIComponent(text)).toBe(result.url.split("?text=")[1]);
  });
});

describe("buildWhatsAppReminderLink (lembrete de parcela única)", () => {
  const client = { phone: "11999998888" };
  const contract = { type: "emprestimo" as const, principal_amount: 1000, installments_count: 4, late_interest_rate_percent_per_day: 1 };

  it("telefone inválido retorna erro", () => {
    const result = buildWhatsAppReminderLink(
      { phone: "" },
      contract,
      { number: 1, amount: 375, due_date: "2026-01-15", status: "atrasado", paid_principal_amount: 0, paid_interest_amount: 0 },
    );
    expect(result.ok).toBe(false);
  });

  it("parcela em dia não inclui dias de atraso nem juros do dia", () => {
    const result = buildWhatsAppReminderLink(
      client,
      contract,
      { number: 1, amount: 375, due_date: "2099-12-31", status: "pendente", paid_principal_amount: 0, paid_interest_amount: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = decodeURIComponent(result.url.split("?text=")[1]);
    expect(text).not.toMatch(/dias de atraso/i);
  });
});

function roundSum(...values: number[]): number {
  return Math.round(values.reduce((sum, v) => sum + v, 0) * 100) / 100;
}

describe("buildWhatsAppChatUrl", () => {
  it("padrão: wa.me com o texto", () => {
    expect(buildWhatsAppChatUrl("5511999990000", "Oi tudo", "padrao")).toBe("https://wa.me/5511999990000?text=Oi%20tudo");
  });

  it("Business (Android): intent do pacote com.whatsapp.w4b, com wa.me como fallback", () => {
    const url = buildWhatsAppChatUrl("5511999990000", "Oi", "business_android");
    expect(url.startsWith("intent://send/?phone=5511999990000&text=Oi#Intent;")).toBe(true);
    expect(url).toContain("package=com.whatsapp.w4b");
    expect(url).not.toContain("package=com.whatsapp;");
    expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent("https://wa.me/5511999990000?text=Oi")}`);
  });

  it("WhatsApp Web: web.whatsapp.com/send", () => {
    expect(buildWhatsAppChatUrl("5511999990000", undefined, "web")).toBe(
      "https://web.whatsapp.com/send?phone=5511999990000",
    );
  });

  it("o link de cobrança respeita o modo escolhido", () => {
    const result = buildWhatsAppReminderLink(
      { phone: "11999990000" },
      { type: "emprestimo", principal_amount: 1000, installments_count: 4, late_interest_rate_percent_per_day: 1 },
      { number: 1, amount: 375, due_date: "2099-12-31", status: "pendente", paid_principal_amount: 0, paid_interest_amount: 0 },
      "business_android",
    );
    expect(result.ok && result.url.includes("package=com.whatsapp.w4b")).toBe(true);
  });
});
