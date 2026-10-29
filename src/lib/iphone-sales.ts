import { roundCents } from "@/lib/financial-rules";
import type { createClient } from "@/lib/supabase/server";
import type { Client, Contract, Phone } from "@/lib/types";

export interface IphoneSale {
  phone: Phone;
  contract: Pick<
    Contract,
    | "id"
    | "status"
    | "principal_amount"
    | "total_amount"
    | "installments_count"
    | "has_down_payment"
    | "down_payment_amount"
  >;
  client: Pick<Client, "id" | "name" | "phone">;
  /** Juros da venda (total a receber − valor da venda). 0 numa venda sem juros. */
  interest: number;
  /** Valor da venda + juros da venda − custo do produto. Nunca depende do que já foi recebido. */
  profit: number;
  /** Soma de tudo já pago pelo cliente nesta venda (entrada + parcelas). */
  received: number;
  /** Valor da venda + juros − recebido, nunca negativo. */
  pending: number;
}

export interface IphoneSalesSummary {
  count: number;
  totalCost: number;
  totalSaleValue: number;
  /** totalSaleValue + juros das vendas − totalCost. */
  totalProfit: number;
  totalReceived: number;
  totalPending: number;
}

/**
 * Todas as vendas de iPhone (operações individuais — cada uma com seu
 * próprio aparelho, sem conceito de estoque). Uma venda cancelada (ex.:
 * cadastrada errada e excluída, mas já com pagamento) fica de fora dos
 * totais/lucro, mas o registro em si continua existindo para auditoria.
 */
export async function getIphoneSales(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ sales: IphoneSale[]; summary: IphoneSalesSummary }> {
  // Os pagamentos vêm aninhados no contrato de cada venda — só os das
  // vendas, em vez de buscar todos os pagamentos (inclusive de empréstimos)
  // para depois descartar a maioria.
  const { data: phonesData } = await supabase
    .from("phones")
    .select(
      "*, contract:contracts(id, status, principal_amount, total_amount, installments_count, has_down_payment, down_payment_amount, client:clients(id, name, phone), payments(principal_amount, interest_amount))",
    )
    .not("contract_id", "is", null)
    .order("created_at", { ascending: false });

  type PhoneRow = Phone & {
    contract:
      | (Pick<
          Contract,
          | "id"
          | "status"
          | "principal_amount"
          | "total_amount"
          | "installments_count"
          | "has_down_payment"
          | "down_payment_amount"
        > & {
          client: Pick<Client, "id" | "name" | "phone">;
          payments: { principal_amount: number; interest_amount: number }[];
        })
      | null;
  };
  const phones = (phonesData ?? []) as PhoneRow[];

  const receivedByContract = new Map<string, number>();
  for (const phone of phones) {
    if (!phone.contract) continue;
    const received = (phone.contract.payments ?? []).reduce(
      (sum, payment) => roundCents(sum + payment.principal_amount + payment.interest_amount),
      0,
    );
    receivedByContract.set(phone.contract.id, received);
  }

  const sales: IphoneSale[] = [];
  for (const phone of phones) {
    if (!phone.contract) continue;

    const saleValue = phone.sale_amount ?? phone.contract.principal_amount;
    // Juros da venda = o que o cliente paga a mais que o valor do produto
    // (parcelas + entrada − valor). Calculado do contrato salvo, nunca
    // recalculado pela taxa atual.
    const downPayment = phone.contract.has_down_payment ? phone.contract.down_payment_amount : 0;
    const interest = roundCents(
      Math.max(phone.contract.total_amount + downPayment - phone.contract.principal_amount, 0),
    );
    const profit = roundCents(saleValue + interest - phone.cost_amount);
    const received = receivedByContract.get(phone.contract.id) ?? 0;
    const pending = roundCents(Math.max(saleValue + interest - received, 0));

    sales.push({
      phone,
      contract: phone.contract,
      client: phone.contract.client,
      interest,
      profit,
      received,
      pending,
    });
  }

  const activeSales = sales.filter((sale) => sale.contract.status !== "cancelado");

  const summary: IphoneSalesSummary = {
    count: activeSales.length,
    totalCost: roundCents(activeSales.reduce((sum, s) => sum + s.phone.cost_amount, 0)),
    totalSaleValue: roundCents(activeSales.reduce((sum, s) => sum + (s.phone.sale_amount ?? 0), 0)),
    totalProfit: roundCents(activeSales.reduce((sum, s) => sum + s.profit, 0)),
    totalReceived: roundCents(activeSales.reduce((sum, s) => sum + s.received, 0)),
    totalPending: roundCents(activeSales.reduce((sum, s) => sum + s.pending, 0)),
  };

  return { sales, summary };
}
