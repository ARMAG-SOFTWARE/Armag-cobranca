"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { nextDueDate } from "@/lib/installments";
import type { Periodicity } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { renewInstallmentSchema, type RenewInstallmentInput } from "@/lib/validations";
import { renewInstallment } from "@/app/actions";

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Renova uma parcela: paga só o juros de atraso pendente agora e empurra o
 * vencimento 1 período pra frente — o principal da parcela nunca é
 * reduzido aqui (continua integralmente em aberto). Uso típico: cliente que
 * só paga o juros todo mês, "rolando" a dívida, até decidir quitar o
 * principal de verdade (pagamento normal, separado).
 */
export function RenewInstallmentDialog({
  installmentId,
  installmentLabel,
  interestOwed,
  dueDate,
  periodicity,
}: {
  installmentId: string;
  installmentLabel: string;
  interestOwed: number;
  dueDate: string;
  periodicity: Periodicity;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<RenewInstallmentInput>({
    resolver: zodResolver(renewInstallmentSchema),
    defaultValues: { notes: "" },
  });

  const projectedNewDueDate = nextDueDate(dueDate, periodicity);

  const onSubmit = handleSubmit(async (data) => {
    const result = await renewInstallment(installmentId, { ...data, idempotencyKey });
    if (result.ok) {
      toast.success("Parcela renovada — vencimento movido pra frente.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao renovar parcela.");
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setIdempotencyKey(newIdempotencyKey());
          reset({ notes: "" });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <RefreshCwIcon />
          Renovar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renovar {installmentLabel}</DialogTitle>
          <DialogDescription>
            Registra o pagamento de só o juros de atraso — o principal desta parcela continua integralmente em
            aberto, cobrável normalmente depois.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1 rounded-md bg-muted px-3 py-2 text-sm">
          <p className="text-muted-foreground">
            Juros de atraso a pagar agora: <span className="font-medium text-foreground">{formatCurrency(interestOwed)}</span>
          </p>
          <p className="text-muted-foreground">
            Novo vencimento: <span className="font-medium text-foreground">{formatDate(projectedNewDueDate)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            O valor exato do juros é sempre conferido de novo no momento da confirmação.
          </p>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Observação (opcional)</Label>
            <Textarea
              id="notes"
              rows={2}
              placeholder="Ex: pagou só o juros, renovou por mais um período"
              {...register("notes")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="animate-spin" />}
              {isSubmitting ? "Renovando..." : "Confirmar renovação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
