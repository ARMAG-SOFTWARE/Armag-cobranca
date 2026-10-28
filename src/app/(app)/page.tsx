import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon, TrendingUpIcon, UsersIcon, WalletIcon } from "lucide-react";

import { DashboardOverview } from "@/components/dashboard-overview";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { ShinyText } from "@/components/ui/shiny-text";
import { StatTile } from "@/components/ui/stat-tile";
import { businessMonthStartUTC } from "@/lib/date-utils";
import { computeDashboardMetrics } from "@/lib/dashboard-metrics";
import { getTodayDebtors } from "@/lib/debtors";
import { createClient } from "@/lib/supabase/server";
import type { ContractWithInstallments, Expense, Payment, Phone } from "@/lib/types";

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
    supabase.from("contracts").select("*, client:clients(*), installments(*)").order("created_at", { ascending: false }),
    supabase.from("payments").select("*"),
    supabase.from("expenses").select("*"),
    supabase.from("phones").select("id, contract_id, cost_amount"),
    getTodayDebtors(supabase),
  ]);

  const contracts = (data ?? []) as ContractWithInstallments[];
  const payments = (paymentsData ?? []) as Payment[];
  const expenses = (expensesData ?? []) as Expense[];
  const phones = (phonesData ?? []) as Pick<Phone, "id" | "contract_id" | "cost_amount">[];
  const metrics = computeDashboardMetrics(contracts, payments, expenses, phones);

  // Contratos cancelados (ex.: cadastrados errado e excluídos) não devem
  // continuar contando como saldo em aberto.
  const nonCancelledContracts = contracts.filter((c) => c.status !== "cancelado");
  const outstandingAmount = nonCancelledContracts
    .flatMap((contract) => contract.installments ?? [])
    .filter((installment) => installment.status !== "pago")
    .reduce((sum, installment) => sum + installment.amount, 0);

  const activeClients = new Set(
    contracts.filter((c) => c.status === "ativo" || c.status === "inadimplente").map((c) => c.client_id),
  ).size;

  const overdueCount = contracts.filter((c) => c.status === "inadimplente").length;

  // Valores já recebidos permanecem no histórico mesmo que o contrato seja
  // cancelado depois — por isso usa `contracts` (todos), não `nonCancelledContracts`.
  const monthStart = businessMonthStartUTC();
  const receivedThisMonth = contracts
    .flatMap((contract) => contract.installments ?? [])
    .filter((installment) => installment.status === "pago" && installment.paid_at)
    .filter((installment) => new Date(installment.paid_at!) >= monthStart)
    .reduce((sum, installment) => sum + installment.amount, 0);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <ShinyText className="text-xs font-semibold uppercase tracking-widest">Painel · RECEBE</ShinyText>
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
