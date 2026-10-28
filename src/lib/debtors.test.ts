import { format, parseISO, subDays } from "date-fns";
import { describe, expect, it } from "vitest";

import { getBusinessToday } from "@/lib/date-utils";
import { getTodayDebtors } from "@/lib/debtors";

const todayStr = getBusinessToday();
const overdueDateStr = format(subDays(parseISO(todayStr), 6), "yyyy-MM-dd");

/**
 * Mock mínimo do client Supabase: cada chamada encadeada (.select/.in/
 * .lte/...) devolve o próprio builder, e `await` nele resolve pro
 * `{ data }` configurado — suficiente pro que `getTodayDebtors` usa, sem
 * precisar de um banco real. Representa a CAMADA DE DADOS já filtrada
 * (como o Postgres devolveria); o que este teste verifica é a AGREGAÇÃO
 * em JS feita depois disso (agrupar por cliente, somar, ordenar, excluir
 * contrato cancelado) — não o filtro SQL em si (`.lte("due_date", ...)`,
 * verificado por leitura direta do código em debtors.ts, não testável de
 * forma significativa sem um Postgres real).
 */
function mockSupabase(installments: unknown[], payments: unknown[] = []) {
  function chain(data: unknown) {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "in", "lte", "not", "gte", "lt", "order", "eq"]) {
      builder[method] = () => builder;
    }
    (builder as { then: unknown }).then = (resolve: (value: { data: unknown }) => void) => resolve({ data });
    return builder;
  }
  return {
    from(table: string) {
      if (table === "installments") return chain(installments);
      if (table === "payments") return chain(payments);
      throw new Error(`tabela inesperada no mock: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function client(id: string, name: string, phone = "11999998888") {
  return { id, owner_id: "owner-1", name, phone, email: null, street: null, street_number: null, neighborhood: null, city: null, state: null, zip_code: null, document_photo_path: null, notes: null, created_at: "", updated_at: "" };
}

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: "contract-1",
    type: "emprestimo",
    status: "inadimplente",
    description: null,
    installments_count: 4,
    principal_amount: 1000,
    late_interest_rate_percent_per_day: 1,
    ...overrides,
  };
}

function installment(overrides: Record<string, unknown> = {}) {
  return {
    id: "installment-1",
    contract_id: "contract-1",
    number: 1,
    amount: 300,
    due_date: overdueDateStr,
    status: "atrasado",
    paid_principal_amount: 0,
    paid_interest_amount: 0,
    paid_at: null,
    reminder_sent_at: null,
    reminder_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("getTodayDebtors", () => {
  it("cenário 8: agrupa parcelas de contratos diferentes do mesmo cliente num único devedor, somando o total", async () => {
    const theClient = client("client-A", "Ana");
    const loanInstallment = {
      ...installment({ id: "i1", contract_id: "loan", number: 2, amount: 300 }),
      contract: { ...contract({ id: "loan", installments_count: 4 }), client: theClient },
    };
    const saleInstallment = {
      ...installment({ id: "i2", contract_id: "sale", number: 1, amount: 200 }),
      contract: { ...contract({ id: "sale", type: "venda_iphone", installments_count: 6 }), client: theClient },
    };

    const { debtors } = await getTodayDebtors(mockSupabase([loanInstallment, saleInstallment]));

    expect(debtors).toHaveLength(1);
    expect(debtors[0].rows).toHaveLength(2);
    expect(debtors[0].totalDue).toBe(debtors[0].rows[0].totalDue + debtors[0].rows[1].totalDue);
  });

  it("nunca conta parcela de contrato cancelado (filtro em JS, independente do filtro SQL de status)", async () => {
    const theClient = client("client-B", "Beto");
    const cancelledInstallment = {
      ...installment({ id: "i3" }),
      contract: { ...contract({ status: "cancelado" }), client: theClient },
    };

    const { debtors, summary } = await getTodayDebtors(mockSupabase([cancelledInstallment]));

    expect(debtors).toHaveLength(0);
    expect(summary.debtorsCount).toBe(0);
    expect(summary.expectedAmount).toBe(0);
  });

  it("cenário 5/6: parcela com saldo zerado (paga ou totalmente coberta por pagamento parcial) nunca aparece", async () => {
    const theClient = client("client-C", "Carla");
    const fullyCoveredInstallment = {
      ...installment({ id: "i4", amount: 300, paid_principal_amount: 300 }),
      contract: { ...contract(), client: theClient },
    };

    const { debtors } = await getTodayDebtors(mockSupabase([fullyCoveredInstallment]));

    expect(debtors).toHaveLength(0);
  });

  it("parcela parcialmente paga mostra só o saldo restante, nunca o valor original", async () => {
    const theClient = client("client-D", "Duda");
    const partiallyPaidInstallment = {
      ...installment({ id: "i5", amount: 300, paid_principal_amount: 100 }),
      contract: { ...contract(), client: theClient },
    };

    const { debtors } = await getTodayDebtors(mockSupabase([partiallyPaidInstallment]));

    expect(debtors).toHaveLength(1);
    expect(debtors[0].rows[0].outstandingPrincipal).toBe(200);
  });

  it("parcela vencendo hoje nunca é tratada como atrasada, e não gera juros", async () => {
    const theClient = client("client-E", "Edu");
    const todayInstallment = {
      ...installment({ id: "i6", due_date: todayStr, status: "pendente" }),
      contract: { ...contract(), client: theClient },
    };

    const { debtors } = await getTodayDebtors(mockSupabase([todayInstallment]));

    expect(debtors).toHaveLength(1);
    expect(debtors[0].rows[0].isOverdue).toBe(false);
    expect(debtors[0].rows[0].interestOwed).toBe(0);
  });
});
