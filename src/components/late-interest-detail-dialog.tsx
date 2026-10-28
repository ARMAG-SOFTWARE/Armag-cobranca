"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatTile } from "@/components/ui/stat-tile";
import type { LateInterestDetailRow } from "@/lib/debtors";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * Card "Juros de atraso" clicável: mostra o total pendente e, ao clicar,
 * abre exatamente o detalhamento de quais clientes/parcelas compõem esse
 * valor — a soma das linhas é sempre igual ao total do card, porque os
 * dois vêm do mesmo cálculo (`getLateInterestBreakdown`).
 */
export function LateInterestCard({
  amount,
  breakdown,
}: {
  amount: number;
  breakdown: LateInterestDetailRow[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="text-left">
          <StatTile label="Juros de atraso" value={amount} format="currency" icon={AlertTriangleIcon} accent="destructive" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Detalhamento dos juros de atraso</DialogTitle>
          <DialogDescription>
            1% ao dia sobre o valor originalmente emprestado, somente para parcelas vencidas e ainda não pagas.
          </DialogDescription>
        </DialogHeader>

        {breakdown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma parcela atrasada no momento.
            <br />
            Não existem juros de atraso pendentes.
          </p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {breakdown.map((row) => (
              <Link
                key={`${row.contractId}-${row.installmentNumber}`}
                href={`/contracts/${row.contractId}`}
                onClick={() => setOpen(false)}
                className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-primary/5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{row.clientName}</span>
                  <span className="font-semibold text-destructive">{formatCurrency(row.interestOwed)}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Parcela {row.installmentNumber}/{row.installmentsCount} · Vencimento {formatDate(row.dueDate)} ·{" "}
                  {row.daysLate} dia{row.daysLate > 1 ? "s" : ""} de atraso
                </span>
                <span className="text-xs text-muted-foreground">
                  Valor originalmente emprestado: {formatCurrency(row.originalPrincipalAmount)} · 1% ao dia
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="font-medium text-muted-foreground">
            Total de parcelas atrasadas: {breakdown.length}
          </span>
          <span className="font-semibold">
            {formatCurrency(breakdown.reduce((sum, row) => sum + row.interestOwed, 0))}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
