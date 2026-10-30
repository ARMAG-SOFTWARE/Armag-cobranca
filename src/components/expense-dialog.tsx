"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MinusIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getBusinessToday } from "@/lib/date-utils";
import { PAYMENT_METHOD_LABELS, type Expense } from "@/lib/types";
import { expenseSchema, type ExpenseInput } from "@/lib/validations";
import { registerExpense, updateExpense } from "@/app/actions";

const today = () => getBusinessToday();

/** Sem `expense`: registra uma saída nova. Com `expense`: edita a existente. */
export function ExpenseDialog({ expense }: { expense?: Expense } = {}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const isEdit = Boolean(expense);
  const initialValues: ExpenseInput = expense
    ? {
        description: expense.description,
        category: expense.category ?? "",
        amount: expense.amount,
        method: expense.method,
        expenseDate: expense.expense_date,
        notes: expense.notes ?? "",
      }
    : ({ method: "dinheiro", expenseDate: today() } as ExpenseInput);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    defaultValues: initialValues,
  });

  const onSubmit = handleSubmit(async (data) => {
    const result = expense ? await updateExpense(expense.id, data) : await registerExpense(data);
    if (result.ok) {
      toast.success(isEdit ? "Saída atualizada." : "Saída registrada.");
      reset(isEdit ? data : initialValues);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao registrar saída.");
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(initialValues);
      }}
    >
      <DialogTrigger asChild>
        {isEdit ? (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
            <PencilIcon />
            Editar
          </Button>
        ) : (
          <Button type="button" variant="outline" size="lg">
            <MinusIcon />
            Registrar saída
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar saída" : "Registrar saída"}</DialogTitle>
          <DialogDescription>Combustível, compra de estoque, manutenção, despesa pessoal, etc.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="description">Descrição</Label>
            <Input id="description" placeholder="Ex: Combustível" {...register("description")} />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="category">Categoria (opcional)</Label>
            <Input id="category" placeholder="Ex: Transporte" {...register("category")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="amount">Valor (R$)</Label>
              <Input id="amount" type="number" step="0.01" min="0" {...register("amount", { valueAsNumber: true })} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="expenseDate">Data</Label>
              <Input id="expenseDate" type="date" {...register("expenseDate")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="method">Forma de pagamento</Label>
            <Controller
              control={control}
              name="method"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Observação (opcional)</Label>
            <Input id="notes" {...register("notes")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : isEdit ? "Salvar alterações" : "Salvar saída"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
