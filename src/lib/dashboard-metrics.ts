import { businessDayRangeUTC, businessMonthStartUTC, businessWeekStartUTC, getBusinessToday } from "@/lib/date-utils";
import { calculateFinancedAmount, roundCents } from "@/lib/financial-rules";
import type { ContractWithInstallments, Expense, Payment, PaymentMethod, Phone } from "@/lib/types";

export interface PeriodAmounts {
  today: number;
  week: number;
  month: number;
  total: number;
}

function emptyPeriod(): PeriodAmounts {
  return { today: 0, week: 0, month: 0, total: 0 };
}

interface PeriodBoundaries {
  dayStart: Date;
  weekStart: Date;
  monthStart: Date;
}

/** Calcula os limites de hoje/semana/mês uma única vez, sempre no fuso do negócio (Brasil). */
function getPeriodBoundaries(now: Date): PeriodBoundaries {
  return {
    dayStart: businessDayRangeUTC(getBusinessToday(now)).start,
    weekStart: businessWeekStartUTC(now),
    monthStart: businessMonthStartUTC(now),
  };
}

function addToPeriod(period: PeriodAmounts, value: number, date: Date, boundaries: PeriodBoundaries) {
  period.total = roundCents(period.total + value);
  if (date >= boundaries.dayStart) period.today = roundCents(period.today + value);
  if (date >= boundaries.weekStart) period.week = roundCents(period.week + value);
  if (date >= boundaries.monthStart) period.month = roundCents(period.month + value);
}

export interface DashboardMetrics {
  /** Visão geral de empréstimos/vendas (item 1 e 2 do pedido). */
  loans: {
    /** Soma de principal_amount — valor original emprestado/vendido, antes do markup. */
    totalPrincipal: number;
    /** Soma de total_amount — valor total previsto para receber (já com os 30%). */
    totalExpected: number;
    /** Principal das parcelas já recebido (não inclui juros nem entradas). */
    totalReceivedPrincipal: number;
    /** totalExpected − totalReceivedPrincipal: quanto ainda falta receber das parcelas. */
    totalOutstanding: number;
    /** Saldo de principal em aberto das parcelas hoje atrasadas. */
    totalOverdue: number;
    /** Entradas recebidas à vista (down payments), fora das parcelas. */
    totalDownPayments: number;
  };
  /** Juros de atraso efetivamente recebidos (item 3 e 5). */
  lateInterestReceived: PeriodAmounts;
  /**
   * "Ganhos" reais do negócio: 100% do juros de atraso recebido, mais a fração
   * de markup (30%) proporcional a cada real de principal de parcela recebido
   * — a entrada (down payment) não gera ganho, é apenas devolução de capital.
   */
  earnings: PeriodAmounts;
  /** Todo dinheiro que entrou (parcelas + juros + entradas), por período. */
  income: PeriodAmounts;
  /** Saídas manuais (despesas), por período. */
  expenses: PeriodAmounts;
  /** income.total − expenses.total. */
  netBalance: number;
  /** Controle de caixa apenas em espécie (item 10 e 11). */
  cash: {
    income: PeriodAmounts;
    expensesTotal: number;
    balance: number;
  };
  /**
   * Saldo geral de caixa — todas as formas de pagamento (diferente de
   * `cash`, que é só espécie) — com débito automático do dinheiro
   * emprestado que já saiu de fato da conta (`contracts.disbursed_at`
   * preenchido). Um empréstimo com `disbursed_at` vazio ("ainda vai sair")
   * nunca debita este saldo. Venda de produto não entra aqui: o custo dela
   * já é rastreado separadamente em `phones`.
   */
  generalCash: {
    income: number;
    expensesTotal: number;
    loansDisbursed: number;
    loansPendingDisbursement: number;
    balance: number;
  };
  /** Total recebido (parcelas + juros + entradas) agrupado por forma de pagamento (item 9 e 12). */
  receivedByMethod: Record<PaymentMethod, number>;
  /**
   * Vendas de iPhone (operações individuais, sem conceito de estoque) —
   * rastreadas separadamente dos empréstimos: lucro aqui é venda − custo de
   * aquisição, nunca juros, e é reconhecido no ato da venda, independente de
   * quanto já foi efetivamente recebido do cliente.
   */
  phones: {
    /** Quantidade de vendas ativas (contrato não cancelado). */
    count: number;
    /** Soma do custo de aquisição de todos os iPhones vendidos. */
    totalCost: number;
    /** Soma do valor de venda (principal_amount do contrato) de todas as vendas. */
    totalSaleValue: number;
    /** totalSaleValue − totalCost — lucro real, indepedente do que já foi recebido. */
    totalProfit: number;
    /** Soma de tudo já efetivamente recebido (entrada + parcelas) nessas vendas. */
    totalReceived: number;
    /** totalSaleValue − totalReceived, nunca negativo. */
    totalPending: number;
  };
}

const EMPTY_METHOD_TOTALS: Record<PaymentMethod, number> = {
  dinheiro: 0,
  pix: 0,
  cartao: 0,
  outro: 0,
};

/**
 * Função pura (sem I/O): recebe os dados já buscados do banco e só
 * calcula os indicadores. Extraída da antiga `getDashboardMetrics` para
 * que a página do dashboard possa reaproveitar os `contracts` (com
 * `installments` aninhadas) que ela já busca para a tabela de clientes,
 * em vez de o dashboard buscar `contracts`/`installments` de novo — duas
 * queries a menos por carregamento do dashboard, sem mudar nenhum valor
 * calculado (a lógica abaixo é idêntica à anterior, só a origem dos dados
 * de contratos/parcelas mudou de "buscar aqui" para "receber como parâmetro").
 */
export function computeDashboardMetrics(
  allContracts: ContractWithInstallments[],
  payments: Payment[],
  expenses: Expense[],
  phones: Pick<Phone, "id" | "contract_id" | "cost_amount">[],
): DashboardMetrics {
  const now = new Date();
  const boundaries = getPeriodBoundaries(now);

  const allInstallments = allContracts.flatMap((c) =>
    c.installments.map((i) => ({
      contract_id: c.id,
      amount: i.amount,
      paid_principal_amount: i.paid_principal_amount,
      status: i.status,
    })),
  );

  // Um empréstimo cancelado (ex.: cadastrado errado e excluído) nunca deve
  // continuar contando nos indicadores de empréstimos — o histórico de
  // pagamentos já recebidos permanece intocado (ver `income`/`earnings`
  // abaixo, que somam todos os `payments` sem filtrar por status do contrato).
  const contracts = allContracts.filter((c) => c.status !== "cancelado");
  const activeContractIds = new Set(contracts.map((c) => c.id));
  const contractsById = new Map(contracts.map((c) => [c.id, c]));
  const installments = allInstallments.filter((i) => activeContractIds.has(i.contract_id));

  // Fração de cada contrato que é markup (lucro), calculada uma única vez por
  // contrato e reaproveitada para todos os pagamentos dele — evita qualquer
  // cálculo divergente entre parcelas do mesmo contrato.
  const markupRatioByContract = new Map<string, number>();
  let totalPrincipal = 0;
  let totalExpected = 0;
  let totalDownPayments = 0;

  for (const contract of contracts) {
    totalPrincipal = roundCents(totalPrincipal + contract.principal_amount);
    totalExpected = roundCents(totalExpected + contract.total_amount);
    if (contract.has_down_payment) {
      totalDownPayments = roundCents(totalDownPayments + contract.down_payment_amount);
    }

    const { markupAmount } = calculateFinancedAmount({
      contractType: contract.type,
      principalAmount: contract.principal_amount,
      installmentsCount: contract.installments_count,
      hasDownPayment: contract.has_down_payment,
      downPaymentAmount: contract.down_payment_amount,
      interestRatePercentPerInstallment: contract.interest_rate_percent,
    });
    markupRatioByContract.set(contract.id, contract.total_amount > 0 ? markupAmount / contract.total_amount : 0);
  }

  // Débito automático do saldo geral: só o que já saiu de fato da conta
  // (`disbursed_at` preenchido) debita agora — "ainda vai sair" fica de
  // fora até o usuário confirmar a data real da saída. Usa `allContracts`
  // (não o `contracts` filtrado acima) de propósito: um empréstimo
  // cancelado só existe cancelado porque já tinha pagamento registrado (ver
  // `deleteContract`), ou seja, o dinheiro realmente saiu antes de o
  // contrato ser cancelado — continua contando aqui, só não entra mais nos
  // indicadores de empréstimo ativo.
  let loansDisbursed = 0;
  let loansPendingDisbursement = 0;
  for (const contract of allContracts) {
    if (contract.type !== "emprestimo") continue;
    if (contract.disbursed_at) {
      loansDisbursed = roundCents(loansDisbursed + contract.principal_amount);
    } else if (contract.status !== "cancelado") {
      loansPendingDisbursement = roundCents(loansPendingDisbursement + contract.principal_amount);
    }
  }

  const totalReceivedPrincipal = roundCents(
    installments.reduce((sum, i) => sum + i.paid_principal_amount, 0),
  );
  const totalOutstanding = roundCents(Math.max(totalExpected - totalReceivedPrincipal, 0));
  const totalOverdue = roundCents(
    installments
      .filter((i) => i.status === "atrasado")
      .reduce((sum, i) => sum + Math.max(i.amount - i.paid_principal_amount, 0), 0),
  );

  const lateInterestReceived = emptyPeriod();
  const earnings = emptyPeriod();
  const income = emptyPeriod();
  const cashIncome = emptyPeriod();
  const receivedByMethod: Record<PaymentMethod, number> = { ...EMPTY_METHOD_TOTALS };
  const receivedByContract = new Map<string, number>();

  for (const payment of payments) {
    const paidAt = new Date(payment.paid_at);
    const total = roundCents(payment.principal_amount + payment.interest_amount);

    addToPeriod(income, total, paidAt, boundaries);
    receivedByMethod[payment.method] = roundCents(receivedByMethod[payment.method] + total);
    if (payment.method === "dinheiro") {
      addToPeriod(cashIncome, total, paidAt, boundaries);
    }

    addToPeriod(lateInterestReceived, payment.interest_amount, paidAt, boundaries);

    const markupRatio = payment.installment_id ? (markupRatioByContract.get(payment.contract_id) ?? 0) : 0;
    const earnedFromPrincipal = roundCents(payment.principal_amount * markupRatio);
    addToPeriod(earnings, roundCents(earnedFromPrincipal + payment.interest_amount), paidAt, boundaries);

    if (activeContractIds.has(payment.contract_id)) {
      receivedByContract.set(payment.contract_id, roundCents((receivedByContract.get(payment.contract_id) ?? 0) + total));
    }
  }

  const expensesPeriod = emptyPeriod();
  let cashExpensesTotal = 0;
  for (const expense of expenses) {
    const expenseDate = businessDayRangeUTC(expense.expense_date).start;
    addToPeriod(expensesPeriod, expense.amount, expenseDate, boundaries);
    if (expense.method === "dinheiro") {
      cashExpensesTotal = roundCents(cashExpensesTotal + expense.amount);
    }
  }

  // Lucro de venda de iPhone é reconhecido no ato da venda (venda − custo),
  // nunca em função do que já foi recebido — por isso soma sempre o
  // principal_amount do contrato, independente de received/pending. Um
  // celular cujo contrato foi cancelado é excluído (contractsById só tem
  // contratos ativos), evitando lucro "fantasma" de venda desfeita.
  let phonesCount = 0;
  let phonesTotalCost = 0;
  let phonesTotalSaleValue = 0;
  let phonesTotalReceived = 0;

  for (const phone of phones) {
    if (!phone.contract_id) continue;
    const contract = contractsById.get(phone.contract_id);
    if (!contract) continue;

    phonesCount += 1;
    phonesTotalCost = roundCents(phonesTotalCost + phone.cost_amount);
    phonesTotalSaleValue = roundCents(phonesTotalSaleValue + contract.principal_amount);
    phonesTotalReceived = roundCents(phonesTotalReceived + (receivedByContract.get(phone.contract_id) ?? 0));
  }

  const phonesTotalProfit = roundCents(phonesTotalSaleValue - phonesTotalCost);
  const phonesTotalPending = roundCents(Math.max(phonesTotalSaleValue - phonesTotalReceived, 0));

  return {
    loans: {
      totalPrincipal,
      totalExpected,
      totalReceivedPrincipal,
      totalOutstanding,
      totalOverdue,
      totalDownPayments,
    },
    lateInterestReceived,
    earnings,
    income,
    expenses: expensesPeriod,
    netBalance: roundCents(income.total - expensesPeriod.total),
    cash: {
      income: cashIncome,
      expensesTotal: cashExpensesTotal,
      balance: roundCents(cashIncome.total - cashExpensesTotal),
    },
    generalCash: {
      income: income.total,
      expensesTotal: expensesPeriod.total,
      loansDisbursed,
      loansPendingDisbursement,
      balance: roundCents(income.total - expensesPeriod.total - loansDisbursed),
    },
    receivedByMethod,
    phones: {
      count: phonesCount,
      totalCost: phonesTotalCost,
      totalSaleValue: phonesTotalSaleValue,
      totalProfit: phonesTotalProfit,
      totalReceived: phonesTotalReceived,
      totalPending: phonesTotalPending,
    },
  };
}
