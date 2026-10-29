import { describe, expect, it } from "vitest";

import { computeDashboardMetrics } from "@/lib/dashboard-metrics";
import type { ContractWithInstallments, Payment } from "@/lib/types";

function contract(overrides: Partial<ContractWithInstallments> = {}): ContractWithInstallments {
  return {
    id: "contract-1",
    owner_id: "owner-1",
    client_id: "client-1",
    type: "emprestimo",
    description: null,
    total_amount: 1300,
    principal_amount: 1000,
    has_down_payment: false,
    down_payment_amount: 0,
    installments_count: 4,
    periodicity: "mensal",
    first_due_date: "2026-01-01",
    status: "ativo",
    interest_rate_percent: 7.5,
    late_interest_rate_percent_per_day: 1,
    disbursed_at: "2026-01-01",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    client: {
      id: "client-1",
      owner_id: "owner-1",
      name: "Ana",
      phone: "11999998888",
      email: null,
      street: null,
      street_number: null,
      neighborhood: null,
      city: null,
      state: null,
      zip_code: null,
      document_photo_path: null,
      notes: null,
      created_at: "",
      updated_at: "",
    },
    installments: [],
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "payment-1",
    owner_id: "owner-1",
    installment_id: null,
    contract_id: "contract-1",
    client_id: "client-1",
    principal_amount: 0,
    interest_amount: 0,
    method: "pix",
    paid_at: "2026-02-01T12:00:00Z",
    notes: null,
    created_by_email: null,
    created_at: "2026-02-01T12:00:00Z",
    is_settlement: false,
    settlement_previous_balance: null,
    ...overrides,
  };
}

describe("computeDashboardMetrics — quitação total/abatimento (is_settlement)", () => {
  it("a diferença perdoada (não recebida) nunca aparece em nenhum indicador — só o valor realmente recebido conta", () => {
    // Dívida de 1250 (1000 principal + 250 juros de atraso), cliente pagou
    // 1000 e os 250 restantes foram perdoados (quitação total).
    const theContract = contract({ total_amount: 1300 });
    const settlementPayment = payment({
      principal_amount: 1000,
      interest_amount: 0,
      is_settlement: true,
      settlement_previous_balance: 1250,
    });

    const metrics = computeDashboardMetrics([theContract], [settlementPayment], [], []);

    // income/receivedByMethod somam exatamente os 1000 recebidos, nunca 1250.
    expect(metrics.income.total).toBe(1000);
    expect(metrics.receivedByMethod.pix).toBe(1000);
    // Nenhum indicador soma os 250 perdoados em lugar nenhum.
    expect(metrics.income.total).not.toBe(1250);
  });

  it("quitação total de um EMPRÉSTIMO conta a fração de lucro (markup) do principal recebido, mesmo sem installment_id", () => {
    // Empréstimo de 1000 com 30% de markup (financedBase 1000 + 300 = 1300) —
    // ratio de markup = 300/1300 ≈ 0.2308.
    const theContract = contract({ principal_amount: 1000, total_amount: 1300, interest_rate_percent: 7.5 });
    const settlementPayment = payment({ principal_amount: 1300, interest_amount: 0, is_settlement: true, settlement_previous_balance: 1300 });

    const metrics = computeDashboardMetrics([theContract], [settlementPayment], [], []);

    // Antes da correção, isto dava 0 (tratava como entrada, que nunca gera lucro).
    expect(metrics.earnings.total).toBeGreaterThan(0);
    expect(metrics.earnings.total).toBeCloseTo(300, 2);
  });

  it("entrada (down payment) de venda de produto continua sem gerar lucro — comportamento antigo preservado", () => {
    const saleContract = contract({
      type: "venda_iphone",
      principal_amount: 1000,
      total_amount: 1000,
      has_down_payment: true,
      down_payment_amount: 200,
      interest_rate_percent: 0,
    });
    const downPayment = payment({ principal_amount: 200, interest_amount: 0, notes: "Entrada", is_settlement: false });

    const metrics = computeDashboardMetrics([saleContract], [downPayment], [], []);

    expect(metrics.earnings.total).toBe(0);
  });

  it("venda de pods com juros: a entrada não gera lucro, a parcela gera a fração de juros", () => {
    // Pod de R$ 100, entrada R$ 40, 20% sobre R$ 60 = R$ 12 → total financiado R$ 72.
    const podContract = contract({
      type: "venda_iphone",
      principal_amount: 100,
      total_amount: 72,
      has_down_payment: true,
      down_payment_amount: 40,
      interest_rate_percent: 20,
    });
    const downPayment = payment({ principal_amount: 40, interest_amount: 0, is_settlement: false });
    const installmentPayment = payment({
      id: "p2",
      installment_id: "i1",
      principal_amount: 72,
      interest_amount: 0,
      is_settlement: false,
    });

    const metrics = computeDashboardMetrics([podContract], [downPayment, installmentPayment], [], []);

    expect(metrics.earnings.total).toBe(12);
  });
});
