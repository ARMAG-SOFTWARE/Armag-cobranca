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
  /** Valor da venda (contract.principal_amount) − custo do aparelho. Nunca depende do que já foi recebido. */
  profit: number;
  /** Soma de tudo já pago pelo cliente nesta venda (entrada + parcelas). */
  received: number;
  /** Valor da venda − recebido, nunca negativo. */
  pending: number;
}

export interface IphoneSalesSummary {
  count: number;
  totalCost: number;
  totalSaleValue: number;
  /** totalSaleValue − totalCost. */
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
  const [{ data: phonesData }, { data: paymentsData }] = await Promise.all([
    supabase
      .from("phones")
      .select(
        "*, contract:contracts(id, status, principal_amount, total_amount, installments_count, has_down_payment, down_payment_amount, client:clients(id, name, phone))",
      )
      .not("contract_id", "is", null)
      .order("created_at", { ascending: false }),
    supabase.from("payments").select("contract_id, principal_amount, interest_amount"),
  ]);

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
        > & { client: Pick<Client, "id" | "name" | "phone"> })
      | null;
  };
  const phones = (phonesData ?? []) as PhoneRow[];
  const payments = (paymentsData ?? []) as { contract_id: string; principal_amount: number; interest_amount: number }[];

  const receivedByContract = new Map<string, number>();
  for (const payment of payments) {
    const total = roundCents(payment.principal_amount + payment.interest_amount);
    receivedByContract.set(payment.contract_id, roundCents((receivedByContract.get(payment.contract_id) ?? 0) + total));
  }

  const sales: IphoneSale[] = [];
  for (const phone of phones) {
    if (!phone.contract) continue;

    const saleValue = phone.sale_amount ?? phone.contract.principal_amount;
    const profit = roundCents(saleValue - phone.cost_amount);
    const received = receivedByContract.get(phone.contract.id) ?? 0;
    const pending = roundCents(Math.max(saleValue - received, 0));

    sales.push({
      phone,
      contract: phone.contract,
      client: phone.contract.client,
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
