import { describe, expect, it } from "vitest";
import {
  allocateSettlement,
  calculateFinancedAmount,
  calculateLateInterest,
  chargeableLateDays,
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

describe("chargeableLateDays", () => {
  // REF = quarta-feira, 2026-01-21.
  it("diária: domingo não conta como dia de atraso", () => {
    // Venceu sexta 16/01: sáb 17, (dom 18), seg 19, ter 20, qua 21 = 4 dias.
    expect(chargeableLateDays("2026-01-16", "diaria", REF)).toBe(4);
    expect(daysLate("2026-01-16", REF)).toBe(5);
  });

  it("diária: venceu no sábado e hoje é domingo = 0 dia de atraso", () => {
    expect(chargeableLateDays("2026-01-17", "diaria", new Date("2026-01-18T15:00:00Z"))).toBe(0);
    expect(chargeableLateDays("2026-01-17", "diaria", new Date("2026-01-19T15:00:00Z"))).toBe(1);
  });

  it("diária: desconta um domingo por semana em atrasos longos", () => {
    // Segunda 05/01 até quarta 21/01: 16 dias corridos, 2 domingos (11 e 18).
    expect(chargeableLateDays("2026-01-05", "diaria", REF)).toBe(14);
  });

  it("demais periodicidades contam todos os dias corridos, inclusive domingo", () => {
    for (const periodicity of ["semanal", "quinzenal", "mensal"] as const) {
      expect(chargeableLateDays("2026-01-16", periodicity, REF)).toBe(5);
    }
  });

  it("nunca é negativo nem conta antes do vencimento", () => {
    expect(chargeableLateDays("2026-01-21", "diaria", REF)).toBe(0);
    expect(chargeableLateDays("2026-02-01", "diaria", REF)).toBe(0);
  });
});

describe("calculateLateInterest", () => {
  const base = {
    lateInterestRatePercentPerDay: 1,
    originalPrincipalAmount: 1000,
    periodicity: "semanal" as const,
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

  it("usa a taxa diária gravada no contrato (configurável)", () => {
    // 6 dias x 2,5% x R$1000 = R$150.
    const result = calculateLateInterest({ ...base, lateInterestRatePercentPerDay: 2.5, dueDate: "2026-01-15" }, REF);
    expect(result).toBe(150);
  });

  it("taxa 0 não gera juros de atraso", () => {
    const result = calculateLateInterest({ ...base, lateInterestRatePercentPerDay: 0, dueDate: "2026-01-15" }, REF);
    expect(result).toBe(0);
  });

  it("vale também para venda de produto (pods): base é o valor total do contrato", () => {
    // Pod de R$100, 3 dias de atraso a 1%/dia = R$3.
    const result = calculateLateInterest(
      { ...base, originalPrincipalAmount: 100, dueDate: "2026-01-18" },
      REF,
    );
    expect(result).toBe(3);
  });

  it("diária: o juros de atraso não corre no domingo", () => {
    // Venceu sexta 16/01: 4 dias cobráveis (sem o domingo) x 1% x R$1000 = R$40.
    expect(calculateLateInterest({ ...base, periodicity: "diaria", dueDate: "2026-01-16" }, REF)).toBe(40);
    // Mesmo vencimento num contrato semanal: 5 dias corridos = R$50.
    expect(calculateLateInterest({ ...base, dueDate: "2026-01-16" }, REF)).toBe(50);
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
  const loan = {
    contractType: "emprestimo" as const,
    principalAmount: 1000,
    hasDownPayment: false,
    downPaymentAmount: 0,
    interestRatePercent: 7.5,
  };

  it.each([
    // [parcelas, periodicidade, % total, total financiado]
    [4, "semanal", 30, 1300],
    [24, "diaria", 30, 1300],
    [2, "quinzenal", 30, 1300],
    [1, "mensal", 30, 1300],
    [3, "mensal", 90, 1900],
    [6, "diaria", 7.5, 1075],
  ] as const)("empréstimo: 7,5%%/semana com %i parcela(s) %s = %d%%", (count, periodicity, ratePercent, total) => {
    const result = calculateFinancedAmount({ ...loan, installmentsCount: count, periodicity });
    expect(result.ratePercent).toBe(ratePercent);
    expect(result.totalFinanced).toBe(total);
  });

  it("empréstimo diário proporcional: 10 diárias = 7,5% ÷ 6 × 10, sem arredondar a taxa antes", () => {
    const result = calculateFinancedAmount({ ...loan, installmentsCount: 10, periodicity: "diaria" });
    expect(result.ratePercent).toBe(12.5);
    expect(result.markupAmount).toBe(125);
    expect(result.totalFinanced).toBe(1125);
  });

  it("empréstimo diário: 7 diárias = 7,5% ÷ 6 × 7, sem arredondar a taxa antes", () => {
    const result = calculateFinancedAmount({ ...loan, installmentsCount: 7, periodicity: "diaria" });
    expect(result.ratePercent).toBe(8.75);
    expect(result.totalFinanced).toBe(1087.5);
  });

  it("empréstimo: a taxa semanal é editável", () => {
    const result = calculateFinancedAmount({ ...loan, interestRatePercent: 10, installmentsCount: 4, periodicity: "semanal" });
    expect(result.totalFinanced).toBe(1400);
  });

  it("venda de produto (pods): juros fixo, independente de parcelas e periodicidade", () => {
    for (const [installmentsCount, periodicity] of [
      [4, "semanal"],
      [24, "diaria"],
      [1, "mensal"],
    ] as const) {
      const result = calculateFinancedAmount({
        contractType: "venda_iphone",
        principalAmount: 100,
        installmentsCount,
        periodicity,
        hasDownPayment: false,
        downPaymentAmount: 0,
        interestRatePercent: 20,
      });
      expect(result.ratePercent).toBe(20);
      expect(result.totalFinanced).toBe(120);
    }
  });

  it("venda de produto: juros incide sobre o valor menos a entrada", () => {
    const result = calculateFinancedAmount({
      contractType: "venda_iphone",
      principalAmount: 100,
      installmentsCount: 4,
      periodicity: "semanal",
      hasDownPayment: true,
      downPaymentAmount: 40,
      interestRatePercent: 20,
    });
    expect(result.financedBase).toBe(60);
    expect(result.markupAmount).toBe(12);
    expect(result.totalFinanced).toBe(72);
  });

  it("venda de produto sem juros quando a taxa é 0", () => {
    const result = calculateFinancedAmount({
      contractType: "venda_iphone",
      principalAmount: 1000,
      installmentsCount: 4,
      periodicity: "semanal",
      hasDownPayment: false,
      downPaymentAmount: 0,
      interestRatePercent: 0,
    });
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
