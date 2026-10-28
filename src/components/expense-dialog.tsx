"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MinusIcon } from "lucide-react";
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
import { PAYMENT_METHOD_LABELS } from "@/lib/types";
import { expenseSchema, type ExpenseInput } from "@/lib/validations";
import { registerExpense } from "@/app/actions";

const today = () => getBusinessToday();

export function ExpenseDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      method: "dinheiro",
      expenseDate: today(),
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    const result = await registerExpense(data);
    if (result.ok) {
      toast.success("Saída registrada.");
      reset({ method: "dinheiro", expenseDate: today() });
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
        if (!next) reset({ method: "dinheiro", expenseDate: today() });
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="lg">
          <MinusIcon />
          Registrar saída
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar saída</DialogTitle>
          <DialogDescription>Combustível, compra de celular, manutenção, despesa pessoal, etc.</DialogDescription>
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
              {isSubmitting ? "Salvando..." : "Salvar saída"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
