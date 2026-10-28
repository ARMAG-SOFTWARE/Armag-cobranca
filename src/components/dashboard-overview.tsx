"use client";

import Link from "next/link";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  BoxIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CoinsIcon,
  HandCoinsIcon,
  PackageCheckIcon,
  PackageIcon,
  PiggyBankIcon,
  ReceiptIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LateInterestCard } from "@/components/late-interest-detail-dialog";
import type { DashboardMetrics } from "@/lib/dashboard-metrics";
import { getLateInterestBreakdown, type Debtor, type TodayDebtorsSummary } from "@/lib/debtors";
import { PAYMENT_METHOD_LABELS } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export function DashboardOverview({
  metrics,
  debtorsSummary,
  debtors,
}: {
  metrics: DashboardMetrics;
  debtorsSummary: TodayDebtorsSummary;
  debtors: Debtor[];
}) {
  const lateInterestBreakdown = getLateInterestBreakdown(debtors);
  const flowChartData = [
    { periodo: "Hoje", Entradas: metrics.income.today, Saídas: metrics.expenses.today },
    { periodo: "Semana", Entradas: metrics.income.week, Saídas: metrics.expenses.week },
    { periodo: "Mês", Entradas: metrics.income.month, Saídas: metrics.expenses.month },
    { periodo: "Total", Entradas: metrics.income.total, Saídas: metrics.expenses.total },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">📅 Devedores de Hoje</CardTitle>
          <Button asChild size="sm">
            <Link href="/debtors">Ver devedores</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Devedores" value={debtorsSummary.debtorsCount} icon={CalendarClockIcon} accent="warning" />
            <StatTile
              label="A receber"
              value={debtorsSummary.expectedAmount}
              format="currency"
              icon={WalletIcon}
              accent="cyan"
            />
            <LateInterestCard amount={debtorsSummary.lateInterestAmount} breakdown={lateInterestBreakdown} />
            <StatTile
              label="Total"
              value={debtorsSummary.totalToReceive}
              format="currency"
              icon={TrendingUpIcon}
              accent="warning"
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            <CheckCircle2Icon className="mr-1 inline size-4 text-success" />
            {debtorsSummary.paidTodayCount} pagos hoje · {formatCurrency(debtorsSummary.receivedToday)} recebido
          </p>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Empréstimos e vendas — Total
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Total emprestado" value={metrics.loans.totalPrincipal} format="currency" icon={HandCoinsIcon} accent="primary" />
          <StatTile label="Previsto para receber" value={metrics.loans.totalExpected} format="currency" icon={WalletIcon} accent="cyan" />
          <StatTile
            label="Recebido (parcelas)"
            value={metrics.loans.totalReceivedPrincipal}
            format="currency"
            icon={TrendingUpIcon}
            accent="success"
          />
          <StatTile label="Ainda a receber" value={metrics.loans.totalOutstanding} format="currency" icon={ReceiptIcon} accent="warning" />
          <StatTile label="Em atraso" value={metrics.loans.totalOverdue} format="currency" icon={AlertTriangleIcon} accent="destructive" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Juros de atraso recebidos
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Diário" value={metrics.lateInterestReceived.today} format="currency" icon={CoinsIcon} accent="success" />
          <StatTile label="Semanal" value={metrics.lateInterestReceived.week} format="currency" icon={CoinsIcon} accent="success" />
          <StatTile label="Mensal" value={metrics.lateInterestReceived.month} format="currency" icon={CoinsIcon} accent="success" />
          <StatTile label="Total" value={metrics.lateInterestReceived.total} format="currency" icon={CoinsIcon} accent="success" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ganhos (30% + juros de atraso já realizados)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Diário" value={metrics.earnings.today} format="currency" icon={TrendingUpIcon} accent="success" />
          <StatTile label="Semanal" value={metrics.earnings.week} format="currency" icon={TrendingUpIcon} accent="success" />
          <StatTile label="Mensal" value={metrics.earnings.month} format="currency" icon={TrendingUpIcon} accent="success" />
          <StatTile label="Total" value={metrics.earnings.total} format="currency" icon={TrendingUpIcon} accent="success" />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fluxo financeiro</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flowChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="periodo" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => formatCurrency(Number(value))} width={90} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                  <Bar dataKey="Entradas" fill="var(--success)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Saídas" fill="var(--destructive)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Saldo líquido (total): <span className="font-medium text-foreground">{formatCurrency(metrics.netBalance)}</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">💵 Dinheiro em caixa</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Entradas hoje" value={metrics.cash.income.today} format="currency" icon={BanknoteIcon} accent="cyan" />
              <StatTile label="Entradas semana" value={metrics.cash.income.week} format="currency" icon={BanknoteIcon} accent="cyan" />
              <StatTile label="Entradas mês" value={metrics.cash.income.month} format="currency" icon={BanknoteIcon} accent="cyan" />
              <StatTile label="Entradas total" value={metrics.cash.income.total} format="currency" icon={BanknoteIcon} accent="cyan" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Saídas em dinheiro" value={metrics.cash.expensesTotal} format="currency" icon={ReceiptIcon} accent="destructive" />
              <StatTile label="Saldo em caixa" value={metrics.cash.balance} format="currency" icon={PiggyBankIcon} accent="success" />
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">💰 Saldo geral (todas as formas de pagamento)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Entradas" value={metrics.generalCash.income} format="currency" icon={BanknoteIcon} accent="cyan" />
              <StatTile label="Saídas (despesas)" value={metrics.generalCash.expensesTotal} format="currency" icon={ReceiptIcon} accent="destructive" />
              <StatTile
                label="Emprestado (já saiu)"
                value={metrics.generalCash.loansDisbursed}
                format="currency"
                icon={HandCoinsIcon}
                accent="warning"
              />
              <StatTile label="Saldo geral" value={metrics.generalCash.balance} format="currency" icon={PiggyBankIcon} accent="success" />
            </div>
            {metrics.generalCash.loansPendingDisbursement > 0 && (
              <p className="text-sm text-muted-foreground">
                <AlertTriangleIcon className="mr-1 inline size-4 text-warning" />
                {formatCurrency(metrics.generalCash.loansPendingDisbursement)} em empréstimos marcados como
                &quot;ainda vai sair&quot; — não debitado deste saldo até a data de saída ser confirmada no contrato.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Vendas de Produtos (operações individuais, separado dos empréstimos)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Vendas" value={metrics.phones.count} icon={BoxIcon} accent="cyan" />
          <StatTile
            label="Total investido"
            value={metrics.phones.totalCost}
            format="currency"
            icon={PackageIcon}
            accent="primary"
          />
          <StatTile
            label="Total em vendas"
            value={metrics.phones.totalSaleValue}
            format="currency"
            icon={HandCoinsIcon}
            accent="warning"
          />
          <StatTile
            label="Lucro real"
            value={metrics.phones.totalProfit}
            format="currency"
            icon={TrendingUpIcon}
            accent="success"
          />
          <StatTile
            label="Total recebido"
            value={metrics.phones.totalReceived}
            format="currency"
            icon={PackageCheckIcon}
            accent="cyan"
          />
          <StatTile
            label="Total pendente"
            value={metrics.phones.totalPending}
            format="currency"
            icon={ReceiptIcon}
            accent="destructive"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recebido por forma de pagamento
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(PAYMENT_METHOD_LABELS) as Array<keyof typeof PAYMENT_METHOD_LABELS>).map((method) => (
            <StatTile
              key={method}
              label={PAYMENT_METHOD_LABELS[method]}
              value={metrics.receivedByMethod[method]}
              format="currency"
              icon={WalletIcon}
              accent="primary"
            />
          ))}
        </div>
      </section>
    </div>
  );
}
