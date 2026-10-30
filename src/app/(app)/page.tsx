import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon, TrendingUpIcon, UsersIcon, WalletIcon } from "lucide-react";

import { DashboardOverview } from "@/components/dashboard-overview";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { ShinyText } from "@/components/ui/shiny-text";
import { StatTile } from "@/components/ui/stat-tile";
import {
  computeDashboardMetrics,
  type DashboardContractInput,
  type DashboardExpenseInput,
  type DashboardPaymentInput,
} from "@/lib/dashboard-metrics";
import { getTodayDebtors } from "@/lib/debtors";
import { roundCents } from "@/lib/financial-rules";
import { createClient } from "@/lib/supabase/server";
import type { Phone } from "@/lib/types";
import { BRAND } from "@/lib/brand";

/**
 * A tela só precisa de `client_id` dos contratos (pra contar clientes
 * ativos), nunca do cadastro completo do cliente — o join `client:clients(*)`
 * usado por outras telas não é necessário aqui.
 */
type DashboardPageContract = DashboardContractInput & { client_id: string };

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Todas as queries independentes desta página disparam juntas, numa
  // única rodada de ida-e-volta ao banco. `contracts` (com `installments`
  // aninhadas) é reaproveitado pelo cálculo dos indicadores do dashboard
  // (`computeDashboardMetrics`).
  const [
    { data, error },
    { data: paymentsData },
    { data: expensesData },
    { data: phonesData },
    { summary: debtorsSummary, debtors },
  ] = await Promise.all([
    // Só as colunas que esta tela usa — nada de `*` nem do cadastro completo
    // do cliente: menos dados trafegando a cada abertura da Visão Geral.
    supabase
      .from("contracts")
      .select(
        "id, client_id, status, type, principal_amount, total_amount, has_down_payment, down_payment_amount, disbursed_at, installments(amount, paid_principal_amount, status)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("paid_at, principal_amount, interest_amount, method, contract_id, installment_id, is_settlement"),
    supabase.from("expenses").select("amount, expense_date, method"),
    supabase.from("phones").select("id, contract_id, cost_amount"),
    getTodayDebtors(supabase),
  ]);

  const contracts = (data ?? []) as DashboardPageContract[];
  const payments = (paymentsData ?? []) as DashboardPaymentInput[];
  const expenses = (expensesData ?? []) as DashboardExpenseInput[];
  const phones = (phonesData ?? []) as Pick<Phone, "id" | "contract_id" | "cost_amount">[];
  const metrics = computeDashboardMetrics(contracts, payments, expenses, phones);

  // Contratos cancelados (ex.: cadastrados errado e excluídos) não devem
  // continuar contando como saldo em aberto.
  const nonCancelledContracts = contracts.filter((c) => c.status !== "cancelado");
  // Saldo realmente em aberto: o que falta de cada parcela não quitada
  // (valor − principal já pago), nunca o valor cheio de uma parcela que
  // já recebeu pagamento parcial.
  const outstandingAmount = roundCents(
    nonCancelledContracts
      .flatMap((contract) => contract.installments ?? [])
      .filter((installment) => installment.status !== "pago")
      .reduce((sum, installment) => sum + Math.max(installment.amount - installment.paid_principal_amount, 0), 0),
  );

  const activeClients = new Set(
    contracts.filter((c) => c.status === "ativo" || c.status === "inadimplente").map((c) => c.client_id),
  ).size;

  const overdueCount = contracts.filter((c) => c.status === "inadimplente").length;

  // Tudo o que entrou no mês, pelos pagamentos registrados — parcela
  // inteira ou parcial, juros, entrada, quitação, abatimento e renovação —
  // o mesmo valor de "Entradas do mês" dos indicadores abaixo.
  const receivedThisMonth = metrics.income.month;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <ShinyText className="text-xs font-semibold uppercase tracking-widest">Painel · {BRAND.name}</ShinyText>
          <GradientHeading className="text-3xl sm:text-4xl">Visão Geral</GradientHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            O resumo completo do negócio — empréstimos, juros, caixa e vendas de produtos.
          </p>
        </div>
        <Link
          href="/clientes"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
        >
          Ver todos os clientes
          <ArrowRightIcon className="size-4" />
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Não foi possível carregar os dados. Verifique se o Supabase está configurado (veja o README) e se a
          migração <code>supabase/migrations/0001_init.sql</code> foi aplicada.
          <br />
          <span className="text-xs opacity-80">{error.message}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <StatTile label="Em aberto" value={outstandingAmount} format="currency" icon={WalletIcon} accent="primary" />
            <StatTile label="Clientes ativos" value={activeClients} icon={UsersIcon} accent="cyan" />
            <StatTile label="Inadimplentes" value={overdueCount} icon={AlertTriangleIcon} accent="destructive" />
            <StatTile
              label="Recebido no mês"
              value={receivedThisMonth}
              format="currency"
              icon={TrendingUpIcon}
              accent="success"
            />
          </div>

          <DashboardOverview metrics={metrics} debtorsSummary={debtorsSummary} debtors={debtors} />
        </>
      )}
    </main>
  );
}
