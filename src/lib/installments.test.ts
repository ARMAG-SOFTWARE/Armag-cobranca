import { describe, expect, it } from "vitest";

import { generateInstallments, installmentPlanSpanDays, splitAmount } from "@/lib/installments";

describe("generateInstallments", () => {
  it("diária vence todo dia corrido, inclusive sábado e domingo", () => {
    // 2026-10-30 é sexta-feira.
    const result = generateInstallments({
      totalAmount: 30,
      installmentsCount: 4,
      periodicity: "diaria",
      firstDueDate: "2026-10-30",
    });
    expect(result.map((i) => i.due_date)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("mantém semanal, quinzenal e mensal como no original", () => {
    const due = (periodicity: "semanal" | "quinzenal" | "mensal") =>
      generateInstallments({ totalAmount: 100, installmentsCount: 2, periodicity, firstDueDate: "2026-01-31" }).map(
        (i) => i.due_date,
      );
    expect(due("semanal")).toEqual(["2026-01-31", "2026-02-07"]);
    expect(due("quinzenal")).toEqual(["2026-01-31", "2026-02-15"]);
    expect(due("mensal")).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("a soma das parcelas é sempre igual ao total (última absorve o arredondamento)", () => {
    const amounts = splitAmount(1107.14, 10);
    expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(1107.14);
  });
});

describe("installmentPlanSpanDays", () => {
  it.each([
    [28, "diaria", 27],
    [4, "semanal", 21],
    [2, "quinzenal", 15],
    [1, "mensal", 0],
    [5, "semanal", 28],
  ] as const)("%i parcela(s) %s = %i dias entre o 1º e o último vencimento", (count, periodicity, days) => {
    expect(installmentPlanSpanDays({ installmentsCount: count, periodicity, firstDueDate: "2026-11-02" })).toBe(days);
  });
});
