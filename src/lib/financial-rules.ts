import { daysBetweenDateStrings, getBusinessToday } from "@/lib/date-utils";
import type { ContractType, InstallmentStatus, Periodicity } from "@/lib/types";

/**
 * Todas as regras de rentabilidade do negócio ficam centralizadas aqui para
 * evitar que cálculos divergentes apareçam em telas diferentes (dashboard,
 * criação de contrato, tela de pagamento).
 *
 * Empréstimo: juros CONTRATUAL definido POR SEMANA, escolhido manualmente a
 * cada cadastro (`contracts.interest_rate_percent`, sugestão de 7,5% por
 * semana). O percentual total é taxa semanal × duração do contrato em
 * semanas, e a duração vem da periodicidade de cada parcela
 * (`WEEKS_PER_INSTALLMENT`): diária = 1/6 de semana (cobrança de segunda a
 * sábado: 7,5% ÷ 6 por parcela), semanal = 1, quinzenal = 2, mensal = 4 (um
 * mês = 30% com 7,5%/semana). Ex.: 4 semanais = 30%; 24 diárias = 30%; 2
 * quinzenais = 30%; 1 mensal = 30%. Esse percentual é aplicado UMA ÚNICA VEZ sobre o valor emprestado e o
 * total é dividido igualmente entre as parcelas — nunca recalculado depois
 * de salvo.
 *
 * Venda de produto (pods; valor interno `venda_iphone`): juros FIXO
 * (sugestão de 20%, editável no cadastro), aplicado uma única vez sobre o
 * valor do produto menos a entrada — não depende da quantidade de parcelas.
 *
 * Juros de atraso: percentual POR DIA sobre o valor total do contrato
 * (`contracts.principal_amount`), para empréstimo e venda de produto. A
 * taxa padrão fica em Configurações e é COPIADA para o contrato no cadastro
 * (`contracts.late_interest_rate_percent_per_day`) — mudar a configuração
 * depois nunca altera contratos já existentes. Nunca é somado ao juros
 * contratual na mesma fórmula; só incide se a parcela não for paga no
 * vencimento. Na periodicidade diária (cobrança de segunda a sábado) o
 * domingo não conta como dia de atraso.
 */
export const DEFAULT_LOAN_INTEREST_RATE_PERCENT = 7.5;
export const DEFAULT_PRODUCT_INTEREST_RATE_PERCENT = 20;
export const DEFAULT_LATE_INTEREST_RATE_PERCENT_PER_DAY = 1;

/** Quantas semanas cada parcela representa, por periodicidade. */
export const WEEKS_PER_INSTALLMENT: Record<Periodicity, number> = {
  // Segunda a sábado: 6 parcelas diárias por semana.
  diaria: 1 / 6,
  semanal: 1,
  quinzenal: 2,
  mensal: 4,
};

/** Venda de produto (pods): todas as parcelas cabem em até 4 semanas a partir do 1º vencimento. */
export const PRODUCT_SALE_MAX_WEEKS = 4;

/** Arredonda para centavos passando por inteiro, evitando erro de ponto flutuante. */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface FinancedAmountInput {
  contractType: ContractType;
  /** Valor original do produto/empréstimo, antes de qualquer juros. */
  principalAmount: number;
  /** Quantidade de parcelas — junto com a periodicidade, define a duração em semanas do empréstimo. */
  installmentsCount: number;
  periodicity: Periodicity;
  /** Só relevante para venda de produto. */
  hasDownPayment: boolean;
  /** Valor recebido à vista, fora das parcelas (ignorado se hasDownPayment = false). */
  downPaymentAmount: number;
  /**
   * Taxa escolhida no cadastro (`contracts.interest_rate_percent`).
   * Empréstimo: percentual POR SEMANA. Venda de produto: percentual fixo
   * sobre o valor financiado.
   */
  interestRatePercent: number;
}

export interface FinancedAmountResult {
  /** Base sobre a qual os juros incidem (principal menos a entrada, se houver). */
  financedBase: number;
  /** Valor dos juros contratuais. */
  markupAmount: number;
  /** financedBase + markupAmount — é isto que é dividido em parcelas. */
  totalFinanced: number;
  /** Taxa efetivamente aplicada, como fração (ex.: 0,3 para 30%), sem arredondamento. */
  rate: number;
  /** A mesma taxa, em percentual, arredondada para exibição (ex.: 30, 10.71). */
  ratePercent: number;
}

/** Duração do contrato em semanas (pode ser fracionária para parcelas diárias). */
export function contractDurationWeeks(installmentsCount: number, periodicity: Periodicity): number {
  return installmentsCount * WEEKS_PER_INSTALLMENT[periodicity];
}

/**
 * Calcula o valor final a ser financiado (dividido em parcelas), aplicando
 * o juros contratual UMA ÚNICA VEZ — empréstimo: taxa semanal × duração em
 * semanas; venda de produto: taxa fixa. A divisão em parcelas é feita
 * depois, por `splitAmount`, que ajusta a última parcela para a soma bater
 * exatamente com o total.
 */
export function calculateFinancedAmount(input: FinancedAmountInput): FinancedAmountResult {
  const downPayment = input.hasDownPayment ? Math.max(input.downPaymentAmount, 0) : 0;
  const financedBase = roundCents(Math.max(input.principalAmount - downPayment, 0));
  const ratePercentExact =
    input.contractType === "emprestimo"
      ? contractDurationWeeks(input.installmentsCount, input.periodicity) * input.interestRatePercent
      : input.interestRatePercent;
  const rate = Math.max(ratePercentExact, 0) / 100;
  const markupAmount = roundCents(financedBase * rate);
  const totalFinanced = roundCents(financedBase + markupAmount);

  return { financedBase, markupAmount, totalFinanced, rate, ratePercent: roundCents(rate * 100) };
}

/**
 * Juros contratual EFETIVO de um contrato já salvo, a partir dos valores
 * gravados (total financiado − base), nunca refazendo a fórmula. Mantém
 * painel e tela do contrato coerentes mesmo se a periodicidade for
 * corrigida depois do cadastro (só as datas mudam; o valor combinado não).
 */
export function storedContractMarkup(contract: {
  principal_amount: number;
  total_amount: number;
  has_down_payment: boolean;
  down_payment_amount: number;
}): { financedBase: number; markupAmount: number; ratePercent: number } {
  const downPayment = contract.has_down_payment ? Math.max(contract.down_payment_amount, 0) : 0;
  const financedBase = roundCents(Math.max(contract.principal_amount - downPayment, 0));
  const markupAmount = roundCents(Math.max(contract.total_amount - financedBase, 0));
  const ratePercent = financedBase > 0 ? roundCents((markupAmount / financedBase) * 100) : 0;
  return { financedBase, markupAmount, ratePercent };
}

/**
 * Quantidade de dias corridos entre o vencimento e a data de referência
 * (0 se ainda não venceu). Compara sempre pelo calendário do fuso horário
 * do negócio (Brasil) — nunca pelo fuso do processo do servidor — para uma
 * parcela de amanhã nunca ser contada como já vencida (ou vice-versa) só
 * por causa de onde o código está rodando.
 */
export function daysLate(dueDate: string, referenceDate: Date = new Date()): number {
  const todayStr = getBusinessToday(referenceDate);
  return Math.max(daysBetweenDateStrings(dueDate, todayStr), 0);
}

/**
 * Dias de atraso que geram juros. Na diária (cobrança de segunda a sábado)
 * os domingos entre o vencimento e a data de referência não contam; nas
 * demais periodicidades é igual a `daysLate` (dias corridos).
 */
export function chargeableLateDays(
  dueDate: string,
  periodicity: Periodicity,
  referenceDate: Date = new Date(),
): number {
  const days = daysLate(dueDate, referenceDate);
  if (periodicity !== "diaria" || days <= 0) return days;

  const [year, month, day] = dueDate.split("-").map(Number);
  const dueWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // Domingos em (vencimento, hoje]: o 1º domingo depois do vencimento cai
  // em `firstSundayOffset` dias; daí em diante, um a cada 7.
  const firstSundayOffset = 7 - dueWeekday;
  const sundays = days >= firstSundayOffset ? Math.floor((days - firstSundayOffset) / 7) + 1 : 0;
  return days - sundays;
}

export interface LateInterestInstallmentInput {
  /**
   * Percentual de juros de atraso POR DIA gravado no contrato no cadastro
   * (`contracts.late_interest_rate_percent_per_day`, ex.: 1 = 1% ao dia).
   * Vale para empréstimo e venda de produto.
   */
  lateInterestRatePercentPerDay: number;
  /**
   * Valor total do CONTRATO (`contracts.principal_amount`: valor emprestado
   * ou valor do produto) — base do juros de atraso. NUNCA o valor da
   * parcela, nem o saldo em aberto dela.
   */
  originalPrincipalAmount: number;
  /** Periodicidade do contrato — na diária, domingo não conta como dia de atraso. */
  periodicity: Periodicity;
  dueDate: string;
  status: InstallmentStatus;
  /**
   * Juros de atraso já efetivamente pago PARA ESTA PARCELA
   * (`installments.paid_interest_amount`) — descontado do juros bruto
   * calculado pela fórmula. Sem isso, um pagamento que já incluiu juros
   * "desaparecia": o juros pendente era recalculado do zero a cada consulta
   * (sempre a partir de due_date/hoje) e voltava a cobrar o que o cliente
   * já tinha pago. Sempre 0 para uma parcela que nunca recebeu pagamento
   * de juros.
   */
  paidInterestAmount: number;
}

/**
 * Juros de atraso: percentual diário do contrato sobre o valor total do
 * contrato (nunca sobre o valor da parcela nem sobre o saldo em aberto
 * dela), calculado a partir da diferença entre due_date e a data de
 * referência, MENOS o que já foi efetivamente pago de juros nesta parcela —
 * o resultado é sempre o juros PENDENTE agora, nunca o bruto acumulado.
 *
 * É uma função PURA e idempotente — parte sempre de due_date/hoje, do valor
 * original do contrato e do juros já pago — por isso é segura para chamar a
 * cada renderização sem risco de "juros sobre juros". Cada parcela usa sua
 * própria due_date e seu próprio paidInterestAmount.
 */
export function calculateLateInterest(
  installment: LateInterestInstallmentInput,
  referenceDate: Date = new Date(),
): number {
  if (installment.status === "pago") {
    return 0;
  }

  const ratePerDay = Math.max(installment.lateInterestRatePercentPerDay, 0) / 100;
  if (ratePerDay === 0) return 0;

  const days = chargeableLateDays(installment.dueDate, installment.periodicity, referenceDate);
  if (days <= 0) return 0;

  const grossInterest = roundCents(installment.originalPrincipalAmount * ratePerDay * days);
  return roundCents(Math.max(grossInterest - installment.paidInterestAmount, 0));
}

export interface SplitPaymentResult {
  /** Parte do pagamento aplicada aos juros em aberto. */
  interestPortion: number;
  /** Parte do pagamento aplicada ao principal da parcela. */
  principalPortion: number;
}

/**
 * Distribui o valor pago primeiro sobre o PRINCIPAL em aberto da parcela e
 * só o que sobrar (se sobrar) vai para o juros de atraso — nunca mais do
 * que existe de saldo em cada um, para não gerar valores negativos nem
 * "sobra" perdida.
 *
 * Um pagamento PARCIAL (que não cobre principal + juros) portanto reduz
 * exclusivamente o saldo principal da parcela; o juros de atraso continua
 * sendo cobrado (calculado ao vivo, sem nenhum desconto) até que um
 * pagamento cubra também o principal inteiro — só nesse momento o que
 * sobrar do pagamento é aplicado ao juros. Isso evita a inconsistência de
 * um pagamento parcial "absorver" parte do juros silenciosamente: antes,
 * juros era descontado primeiro, então o saldo principal parecia maior do
 * que o cliente esperava (ex.: pagou R$200 de uma parcela de R$325 com
 * R$70 de juros, e o saldo principal ficava em R$195 em vez de R$125 —
 * exatamente os R$70 de juros "sumiam" do principal sem aparecer como
 * juros pago em lugar nenhum, e continuavam sendo cobrados de novo).
 */
export function splitPayment(
  amountPaid: number,
  interestOwed: number,
  principalOwed: number,
): SplitPaymentResult {
  const principalPortion = roundCents(Math.min(Math.max(amountPaid, 0), Math.max(principalOwed, 0)));
  const remaining = roundCents(Math.max(amountPaid - principalPortion, 0));
  const interestPortion = roundCents(Math.min(remaining, Math.max(interestOwed, 0)));

  return { interestPortion, principalPortion };
}

export interface SettlementInstallmentInput {
  id: string;
  number: number;
  /** Saldo de principal ainda em aberto desta parcela (amount − paid_principal_amount, nunca negativo). */
  outstandingPrincipal: number;
  /** Juros de atraso pendente desta parcela, já calculado via `calculateLateInterest` (0 para venda de produto). */
  interestOwed: number;
}

export interface SettlementAllocation {
  id: string;
  principalApplied: number;
  interestApplied: number;
}

export interface SettlementAllocationResult {
  allocations: SettlementAllocation[];
  totalPrincipalApplied: number;
  totalInterestApplied: number;
  totalApplied: number;
  /** Soma do saldo (principal + juros) de TODAS as parcelas em aberto, antes da quitação. */
  previousBalance: number;
  /** previousBalance − totalApplied, nunca negativo — a parte do saldo perdoada no acordo (nunca lançada como dinheiro recebido). */
  waivedAmount: number;
}

/**
 * Quitação total: distribui o valor recebido entre as parcelas ainda em
 * aberto do contrato, da mais antiga para a mais nova, usando a MESMA regra
 * já usada em cada parcela individualmente (`splitPayment`: primeiro cobre
 * o principal, só depois o juros) — generalizada aqui para várias parcelas
 * em sequência em vez de uma só. Nunca aplica mais do que o saldo de cada
 * parcela; o que sobrar sem cobertura (quando o valor recebido é menor que
 * o saldo total) é `waivedAmount` — a diferença do acordo, que esta função
 * nunca inventa como dinheiro recebido, só calcula para exibição/auditoria.
 *
 * Função PURA — nunca escreve no banco. Quem decide se pode gravar (ex.:
 * rejeitar valor recebido maior que `previousBalance`) é sempre o chamador
 * (`settleContract`, em actions.ts).
 */
export function allocateSettlement(
  installments: SettlementInstallmentInput[],
  amountReceived: number,
): SettlementAllocationResult {
  const sorted = [...installments].sort((a, b) => a.number - b.number);
  const previousBalance = roundCents(
    sorted.reduce((sum, installment) => sum + installment.outstandingPrincipal + installment.interestOwed, 0),
  );

  let remaining = roundCents(Math.max(amountReceived, 0));
  const allocations: SettlementAllocation[] = [];
  let totalPrincipalApplied = 0;
  let totalInterestApplied = 0;

  for (const installment of sorted) {
    const { principalPortion, interestPortion } = splitPayment(
      remaining,
      installment.interestOwed,
      installment.outstandingPrincipal,
    );
    allocations.push({ id: installment.id, principalApplied: principalPortion, interestApplied: interestPortion });
    totalPrincipalApplied = roundCents(totalPrincipalApplied + principalPortion);
    totalInterestApplied = roundCents(totalInterestApplied + interestPortion);
    remaining = roundCents(Math.max(remaining - principalPortion - interestPortion, 0));
  }

  const totalApplied = roundCents(totalPrincipalApplied + totalInterestApplied);
  const waivedAmount = roundCents(Math.max(previousBalance - totalApplied, 0));

  return { allocations, totalPrincipalApplied, totalInterestApplied, totalApplied, previousBalance, waivedAmount };
}
