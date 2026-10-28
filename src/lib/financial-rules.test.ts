import { describe, expect, it } from "vitest";
import {
  allocateSettlement,
  calculateFinancedAmount,
  calculateLateInterest,
  daysLate,
  roundCents,
  splitPayment,
  type SettlementInstallmentInput,
} from "@/lib/financial-rules";

// Horário fixo em meio-dia UTC-3 (Brasília) pra nunca cair numa borda de
// fuso horário — todos os testes de data/juros usam esta referência.
const REF = new Date("2026-01-21T15:00:00Z");

describe("roundCents", () => {
  it("corrige ruído de ponto flutuante (cenário 11)", () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(roundCents(19.999999999)).toBe(20);
  });
});

describe("daysLate", () => {
  it("é 0 no próprio dia do vencimento — parcela vencendo hoje nunca é tratada como atrasada (cenário 1)", () => {
    expect(daysLate("2026-01-21", REF)).toBe(0);
  });

  it("conta a partir do dia seguinte ao vencimento", () => {
    expect(daysLate("2026-01-15", REF)).toBe(6);
  });

  it("nunca é negativo para um vencimento futuro (cenário 13)", () => {
    expect(daysLate("2026-02-01", REF)).toBe(0);
  });
});

describe("calculateLateInterest", () => {
  const base = {
    contractType: "emprestimo" as const,
    originalPrincipalAmount: 1000,
    status: "atrasado" as const,
    paidInterestAmount: 0,
  };

  it("cenário 1: sem juros no dia do vencimento (ainda pendente, não atrasada)", () => {
    const result = calculateLateInterest({ ...base, dueDate: "2026-01-21", status: "pendente" }, REF);
    expect(result).toBe(0);
  });

  it("cenário 2: 1%/dia sobre o principal ORIGINAL do contrato (nunca sobre a parcela)", () => {
    // 6 dias de atraso x 1% x R$1000 = R$60 — nunca usa o valor da parcela.
    const result = calculateLateInterest({ ...base, dueDate: "2026-01-15" }, REF);
    expect(result).toBe(60);
  });

  it("venda de iPhone nunca gera juros de atraso, mesmo vencida há dias", () => {
    const result = calculateLateInterest({ ...base, contractType: "venda_iphone", dueDate: "2026-01-15" }, REF);
    expect(result).toBe(0);
  });

  it("cenário 6: parcela já totalmente paga nunca gera juros", () => {
    const result = calculateLateInterest({ ...base, dueDate: "2026-01-15", status: "pago" }, REF);
    expect(result).toBe(0);
  });

  it("cenário 9: desconta o juros já pago (pagamento recente), nunca cobra de novo o que já foi quitado", () => {
    const gross = calculateLateInterest({ ...base, dueDate: "2026-01-15" }, REF); // 60
    const afterPartial = calculateLateInterest({ ...base, dueDate: "2026-01-15", paidInterestAmount: 40 }, REF);
    expect(afterPartial).toBe(roundCents(gross - 40));
  });

  it("cenário 10 (parte 1): nunca fica negativo mesmo se o juros pago exceder o devido", () => {
    const result = calculateLateInterest({ ...base, dueDate: "2026-01-15", paidInterestAmount: 9999 }, REF);
    expect(result).toBe(0);
  });

  it("cenário 10 (parte 2): idempotente — duas chamadas iguais no mesmo instante nunca duplicam o juros", () => {
    const first = calculateLateInterest({ ...base, dueDate: "2026-01-15" }, REF);
    const second = calculateLateInterest({ ...base, dueDate: "2026-01-15" }, REF);
    expect(first).toBe(second);
    expect(first).toBe(60);
  });
});

describe("splitPayment", () => {
  it("cenário 5: pagamento parcial vai inteiro pro principal, juros fica intocado", () => {
    const result = splitPayment(200, 70, 325);
    expect(result.principalPortion).toBe(200);
    expect(result.interestPortion).toBe(0);
  });

  it("só aplica no juros o que sobra depois do principal totalmente coberto", () => {
    const result = splitPayment(395, 70, 325);
    expect(result.principalPortion).toBe(325);
    expect(result.interestPortion).toBe(70);
  });

  it("nunca ultrapassa o que está em aberto em cada parte, mesmo com valor pago maior que o total", () => {
    const result = splitPayment(1000, 70, 325);
    expect(result.principalPortion).toBe(325);
    expect(result.interestPortion).toBe(70);
  });
});

describe("calculateFinancedAmount", () => {
  it("empréstimo: taxa manual x parcelas, aplicada uma única vez", () => {
    const result = calculateFinancedAmount({
      contractType: "emprestimo",
      principalAmount: 1000,
      installmentsCount: 4,
      hasDownPayment: false,
      downPaymentAmount: 0,
      interestRatePercentPerInstallment: 7.5,
    });
    expect(result.ratePercent).toBe(30);
    expect(result.markupAmount).toBe(300);
    expect(result.totalFinanced).toBe(1300);
  });

  it("venda de iPhone nunca tem juros automático, mesmo com uma taxa informada", () => {
    const result = calculateFinancedAmount({
      contractType: "venda_iphone",
      principalAmount: 1000,
      installmentsCount: 4,
      hasDownPayment: false,
      downPaymentAmount: 0,
      interestRatePercentPerInstallment: 50,
    });
    expect(result.ratePercent).toBe(0);
    expect(result.markupAmount).toBe(0);
    expect(result.totalFinanced).toBe(1000);
  });
});

describe("allocateSettlement (quitação total)", () => {
  function installment(overrides: Partial<SettlementInstallmentInput> = {}): SettlementInstallmentInput {
    return { id: "i1", number: 1, outstandingPrincipal: 300, interestOwed: 0, ...overrides };
  }

  it("quitação pelo valor integral do saldo devedor: nada é perdoado", () => {
    const installments = [
      installment({ id: "i1", number: 1, outstandingPrincipal: 300, interestOwed: 18 }),
      installment({ id: "i2", number: 2, outstandingPrincipal: 375, interestOwed: 0 }),
    ];
    const result = allocateSettlement(installments, 693);

    expect(result.previousBalance).toBe(693);
    expect(result.totalApplied).toBe(693);
    expect(result.waivedAmount).toBe(0);
  });

  it("quitação por valor inferior ao saldo (acordo): a diferença some como waivedAmount, nunca como recebido", () => {
    const installments = [
      installment({ id: "i1", number: 1, outstandingPrincipal: 300, interestOwed: 18 }),
      installment({ id: "i2", number: 2, outstandingPrincipal: 375, interestOwed: 0 }),
    ];
    const result = allocateSettlement(installments, 500);

    expect(result.previousBalance).toBe(693);
    expect(result.totalApplied).toBe(500);
    expect(result.waivedAmount).toBe(193);
    // Nunca conta o mesmo dinheiro duas vezes: a soma do que foi aplicado a
    // cada parcela bate exatamente com o total aplicado.
    const sumApplied = roundCents(
      result.allocations.reduce((sum, a) => sum + a.principalApplied + a.interestApplied, 0),
    );
    expect(sumApplied).toBe(result.totalApplied);
  });

  it("distribui da parcela mais antiga (menor número) para a mais nova, nunca na ordem inversa", () => {
    const installments = [
      installment({ id: "i2", number: 2, outstandingPrincipal: 300, interestOwed: 0 }),
      installment({ id: "i1", number: 1, outstandingPrincipal: 300, interestOwed: 0 }),
    ];
    // Só dá pra cobrir a primeira parcela (por número) inteira.
    const result = allocateSettlement(installments, 300);

    const first = result.allocations.find((a) => a.id === "i1")!;
    const second = result.allocations.find((a) => a.id === "i2")!;
    expect(first.principalApplied).toBe(300);
    expect(second.principalApplied).toBe(0);
  });

  it("dentro de cada parcela, cobre primeiro o principal e só depois o juros (mesma regra de splitPayment)", () => {
    const installments = [installment({ outstandingPrincipal: 300, interestOwed: 90 })];
    const result = allocateSettlement(installments, 350);

    expect(result.allocations[0].principalApplied).toBe(300);
    expect(result.allocations[0].interestApplied).toBe(50);
  });

  it("nunca aplica mais do que o saldo de uma parcela, mesmo com valor recebido muito maior", () => {
    const installments = [installment({ outstandingPrincipal: 300, interestOwed: 0 })];
    const result = allocateSettlement(installments, 999999);

    expect(result.allocations[0].principalApplied).toBe(300);
    expect(result.totalApplied).toBe(300);
    // O excedente além do saldo devedor NUNCA é aplicado nem contado como
    // recebido — quem decide recusar esse caso é sempre o chamador
    // (settleContract em actions.ts), comparando amountReceived com
    // previousBalance antes de chamar esta função.
    expect(result.previousBalance).toBe(300);
  });

  it("venda de produto (sem juros de atraso) distribui só o principal", () => {
    const installments = [
      installment({ id: "i1", number: 1, outstandingPrincipal: 200, interestOwed: 0 }),
      installment({ id: "i2", number: 2, outstandingPrincipal: 200, interestOwed: 0 }),
    ];
    const result = allocateSettlement(installments, 250);

    expect(result.totalInterestApplied).toBe(0);
    expect(result.totalPrincipalApplied).toBe(250);
  });

  it("valor recebido zero não aplica nada e perdoa o saldo inteiro, sem lançar exceção", () => {
    const installments = [installment({ outstandingPrincipal: 300, interestOwed: 18 })];
    const result = allocateSettlement(installments, 0);

    expect(result.totalApplied).toBe(0);
    expect(result.waivedAmount).toBe(318);
    expect(result.allocations[0].principalApplied).toBe(0);
    expect(result.allocations[0].interestApplied).toBe(0);
  });
});
