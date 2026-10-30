"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Expense } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { deleteExpense } from "@/app/actions";

export function DeleteExpenseDialog({ expense }: { expense: Pick<Expense, "id" | "description" | "amount" | "expense_date"> }) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    setIsDeleting(true);
    const result = await deleteExpense(expense.id);
    setIsDeleting(false);

    if (result.ok) {
      toast.success("Saída excluída.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao excluir saída.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
          <TrashIcon />
          Excluir
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir saída?</DialogTitle>
          <DialogDescription>
            {expense.description} · {formatCurrency(expense.amount)} em {formatDate(expense.expense_date)}. O valor deixa
            de ser descontado do caixa. Essa ação não poderá ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" disabled={isDeleting} onClick={handleConfirm}>
            {isDeleting ? "Excluindo..." : "Confirmar exclusão"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
