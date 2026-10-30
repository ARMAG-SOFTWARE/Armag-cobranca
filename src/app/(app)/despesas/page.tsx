import { CalendarIcon, ReceiptIcon, WalletIcon } from "lucide-react";

import { DeleteExpenseDialog } from "@/components/delete-expense-dialog";
import { ExpenseDialog } from "@/components/expense-dialog";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { ShinyText } from "@/components/ui/shiny-text";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { StatTile } from "@/components/ui/stat-tile";
import { BRAND } from "@/lib/brand";
import { getBusinessToday } from "@/lib/date-utils";
import { roundCents } from "@/lib/financial-rules";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_METHOD_LABELS, type Expense } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DespesasPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, owner_id, description, category, amount, method, expense_date, notes, created_by_email, created_at")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const expenses = (data ?? []) as Expense[];
  // Mês corrente no fuso do negócio, comparando a data (AAAA-MM) da saída.
  const currentMonth = getBusinessToday().slice(0, 7);
  const monthTotal = roundCents(
    expenses.filter((e) => e.expense_date.startsWith(currentMonth)).reduce((sum, e) => sum + e.amount, 0),
  );
  const total = roundCents(expenses.reduce((sum, e) => sum + e.amount, 0));

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <ShinyText className="text-xs font-semibold uppercase tracking-widest">Painel · {BRAND.name}</ShinyText>
          <GradientHeading className="text-3xl sm:text-4xl">Despesas</GradientHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            Saídas registradas — corrija ou exclua uma saída lançada errada.
          </p>
        </div>
        <ExpenseDialog />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Saídas no mês" value={monthTotal} format="currency" icon={CalendarIcon} accent="warning" />
        <StatTile label="Total de saídas" value={total} format="currency" icon={WalletIcon} accent="destructive" />
        <StatTile label="Lançamentos" value={expenses.length} icon={ReceiptIcon} accent="primary" />
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Não foi possível carregar as despesas.
        </div>
      ) : expenses.length === 0 ? (
        <SpotlightCard>
          <p className="p-10 text-center text-sm text-muted-foreground">Nenhuma saída registrada ainda.</p>
        </SpotlightCard>
      ) : (
        <div className="flex flex-col gap-2">
          {expenses.map((expense) => (
            <div
              key={expense.id}
              className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <span className="font-medium">{expense.description}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {PAYMENT_METHOD_LABELS[expense.method]}
                  {expense.category ? ` · ${expense.category}` : ""}
                </span>
                {expense.notes && <p className="text-xs text-muted-foreground">{expense.notes}</p>}
                {expense.created_by_email && (
                  <p className="text-xs text-muted-foreground">Registrado por {expense.created_by_email}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{formatCurrency(expense.amount)}</span>
                <span className="text-xs text-muted-foreground">{formatDate(expense.expense_date)}</span>
                <ExpenseDialog expense={expense} />
                <DeleteExpenseDialog expense={expense} />
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
