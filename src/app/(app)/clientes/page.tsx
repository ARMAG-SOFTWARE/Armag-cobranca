import { ClientsTable } from "@/components/clients-table";
import { ExpenseDialog } from "@/components/expense-dialog";
import { NewTransactionDialog } from "@/components/new-transaction-dialog";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { ShinyText } from "@/components/ui/shiny-text";
import { createClient } from "@/lib/supabase/server";
import type { ContractWithInstallments } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const supabase = await createClient();

  // Cancelado e quitado saem da visão geral de propósito — poluíam a
  // listagem e dificultavam ver o que realmente precisa de atenção. Os
  // dados continuam intactos no banco (histórico, pagamentos, dashboard),
  // só não entram mais nesta tela.
  const { data, error } = await supabase
    .from("contracts")
    .select("*, client:clients(*), installments(*)")
    .neq("status", "cancelado")
    .neq("status", "quitado")
    .order("created_at", { ascending: false });

  const contracts = (data ?? []) as ContractWithInstallments[];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <ShinyText className="text-xs font-semibold uppercase tracking-widest">Painel · RECEBE</ShinyText>
          <GradientHeading className="text-3xl sm:text-4xl">Clientes</GradientHeading>
          <p className="mt-1 text-sm text-muted-foreground">
            Empréstimos e vendas de produtos parceladas — visão geral e status de cobrança.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExpenseDialog />
          <NewTransactionDialog />
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Não foi possível carregar os dados. Verifique se o Supabase está configurado (veja o README) e se a
          migração <code>supabase/migrations/0001_init.sql</code> foi aplicada.
          <br />
          <span className="text-xs opacity-80">{error.message}</span>
        </div>
      ) : (
        <ClientsTable contracts={contracts} />
      )}
    </main>
  );
}
