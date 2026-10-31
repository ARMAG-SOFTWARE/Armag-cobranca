import { describe, expect, it } from "vitest";

import {
  firstChargeDate,
  generateInstallments,
  installmentPlanSpanDays,
  nextDueDate,
  reflowSchedule,
  splitAmount,
  type ScheduleInstallmentInput,
} from "@/lib/installments";

function installment(overrides: Partial<ScheduleInstallmentInput> = {}): ScheduleInstallmentInput {
  return { number: 1, due_date: "2026-01-01", locked: false, ...overrides };
}

describe("reflowSchedule", () => {
  it("sem nenhuma parcela travada, a 1ª usa sempre o firstDueDate do contrato", () => {
    const installments = [
      installment({ number: 1, due_date: "2026-01-01" }),
      installment({ number: 2, due_date: "2026-02-01" }),
    ];
    const result = reflowSchedule(installments, "semanal", "2026-01-01");

    expect(result[0].due_date).toBe("2026-01-01");
    expect(result[1].due_date).toBe("2026-01-08"); // +7 dias a partir da parcela 1
  });

  it("nunca muda a data de uma parcela já paga (travada), mesmo trocando a periodicidade", () => {
    const installments = [
      installment({ number: 1, due_date: "2026-01-01", locked: true }),
      installment({ number: 2, due_date: "2026-02-01", locked: false }),
      installment({ number: 3, due_date: "2026-03-01", locked: false }),
    ];
    const result = reflowSchedule(installments, "semanal", "2026-01-01");

    expect(result[0].due_date).toBe("2026-01-01");
    expect(result[0].changed).toBe(false);
  });

  it("continua a sequência a partir da ÚLTIMA parcela travada, nunca do 1º vencimento original", () => {
    const installments = [
      installment({ number: 1, due_date: "2026-01-01", locked: true }),
      installment({ number: 2, due_date: "2026-02-01", locked: true }),
      installment({ number: 3, due_date: "2026-03-01", locked: false }),
      installment({ number: 4, due_date: "2026-04-01", locked: false }),
    ];
    const result = reflowSchedule(installments, "semanal", "2026-01-01");

    // Parcela 2 (travada) foi paga em 01/02 — parcela 3 passa a ser 7 dias
    // depois dela, não mais 1 mês depois (periodicidade antiga).
    expect(result[1].due_date).toBe("2026-02-01");
    expect(result[2].due_date).toBe("2026-02-08");
    expect(result[2].changed).toBe(true);
    expect(result[3].due_date).toBe("2026-02-15");
  });

  it("periodicidade quinzenal soma 15 dias por período, não 14", () => {
    const installments = [installment({ number: 1, due_date: "2026-01-01", locked: true }), installment({ number: 2, due_date: "2026-02-01" })];
    const result = reflowSchedule(installments, "quinzenal", "2026-01-01");
    expect(result[1].due_date).toBe("2026-01-16");
  });

  it("periodicidade mensal soma meses de calendário, não 30 dias fixos", () => {
    const installments = [installment({ number: 1, due_date: "2026-01-31", locked: true }), installment({ number: 2, due_date: "2026-03-01" })];
    const result = reflowSchedule(installments, "mensal", "2026-01-31");
    expect(result[1].due_date).toBe("2026-02-28"); // date-fns addMonths ajusta fim de mês
  });

  it("quando nenhuma parcela muda de data (mesma periodicidade), changed é sempre false", () => {
    const installments = [
      installment({ number: 1, due_date: "2026-01-01" }),
      installment({ number: 2, due_date: "2026-02-01" }),
      installment({ number: 3, due_date: "2026-03-01" }),
    ];
    const result = reflowSchedule(installments, "mensal", "2026-01-01");
    expect(result.every((r) => !r.changed)).toBe(true);
  });
});

describe("reflowSchedule — diária (segunda a sábado)", () => {
  const installment = (overrides: Partial<ScheduleInstallmentInput>): ScheduleInstallmentInput => ({
    number: 1,
    due_date: "2026-11-01",
    locked: false,
    ...overrides,
  });

  it("ao passar para diária, reencaixa as parcelas abertas sem cair no domingo", () => {
    // 1º vencimento num domingo (01/11): na diária vira segunda 02/11.
    const result = reflowSchedule(
      [
        installment({ number: 1, due_date: "2026-11-01" }),
        installment({ number: 2, due_date: "2026-11-08" }),
        installment({ number: 3, due_date: "2026-11-15" }),
      ],
      "diaria",
      "2026-11-01",
    );
    expect(result.map((r) => r.due_date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  it("parcela paga no sábado: a próxima aberta vai para segunda", () => {
    const result = reflowSchedule(
      [
        installment({ number: 1, due_date: "2026-10-31", locked: true }),
        installment({ number: 2, due_date: "2026-11-07" }),
      ],
      "diaria",
      "2026-10-31",
    );
    expect(result.map((r) => r.due_date)).toEqual(["2026-10-31", "2026-11-02"]);
  });
});

describe("nextDueDate", () => {
  it("empurra 1 mês (calendário, não 30 dias fixos) — usado pela renovação de parcela", () => {
    expect(nextDueDate("2026-01-31", "mensal")).toBe("2026-02-28");
  });

  it("empurra 7 dias no semanal", () => {
    expect(nextDueDate("2026-01-01", "semanal")).toBe("2026-01-08");
  });

  it("empurra 15 dias no quinzenal", () => {
    expect(nextDueDate("2026-01-01", "quinzenal")).toBe("2026-01-16");
  });

  it("diária: renovar uma parcela de sábado leva para segunda (pula o domingo)", () => {
    expect(nextDueDate("2026-10-31", "diaria")).toBe("2026-11-02");
    expect(nextDueDate("2026-11-02", "diaria")).toBe("2026-11-03");
  });
});

describe("firstChargeDate", () => {
  it("diária: domingo vira segunda; outro dia não muda", () => {
    expect(firstChargeDate("2026-11-01", "diaria")).toBe("2026-11-02");
    expect(firstChargeDate("2026-10-31", "diaria")).toBe("2026-10-31");
  });

  it("demais periodicidades mantêm o domingo escolhido", () => {
    expect(firstChargeDate("2026-11-01", "semanal")).toBe("2026-11-01");
    expect(firstChargeDate("2026-11-01", "mensal")).toBe("2026-11-01");
  });
});

describe("generateInstallments", () => {
  it("diária vence de segunda a sábado, pulando o domingo", () => {
    // 2026-10-30 é sexta-feira; 01/11 é domingo.
    const result = generateInstallments({
      totalAmount: 30,
      installmentsCount: 4,
      periodicity: "diaria",
      firstDueDate: "2026-10-30",
    });
    expect(result.map((i) => i.due_date)).toEqual(["2026-10-30", "2026-10-31", "2026-11-02", "2026-11-03"]);
  });

  it("diária com 1º vencimento no domingo começa na segunda-feira seguinte", () => {
    const result = generateInstallments({
      totalAmount: 30,
      installmentsCount: 2,
      periodicity: "diaria",
      firstDueDate: "2026-11-01",
    });
    expect(result.map((i) => i.due_date)).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("diária: 6 parcelas por semana (segunda a sábado)", () => {
    const result = generateInstallments({
      totalAmount: 120,
      installmentsCount: 12,
      periodicity: "diaria",
      firstDueDate: "2026-11-02",
    });
    expect(result.map((i) => i.due_date)).not.toContain("2026-11-08");
    expect(result[5].due_date).toBe("2026-11-07"); // 6ª parcela: sábado
    expect(result[6].due_date).toBe("2026-11-09"); // 7ª parcela: segunda
    expect(result[11].due_date).toBe("2026-11-14");
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
    [24, "diaria", 26],
    [25, "diaria", 28],
    [4, "semanal", 21],
    [2, "quinzenal", 15],
    [1, "mensal", 0],
    [5, "semanal", 28],
  ] as const)("%i parcela(s) %s = %i dias entre o 1º e o último vencimento", (count, periodicity, days) => {
    expect(installmentPlanSpanDays({ installmentsCount: count, periodicity, firstDueDate: "2026-11-02" })).toBe(days);
  });
});
