"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { WalletIcon } from "lucide-react";
import { toast } from "sonner";

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
import { Switch } from "@/components/ui/switch";
import { calculateLateInterest, roundCents } from "@/lib/financial-rules";
import { PAYMENT_METHOD_LABELS, type ContractType, type Installment } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { paymentSchema, type PaymentInput } from "@/lib/validations";
import { registerPayment } from "@/app/actions";

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Reaproveitada tanto na grade de parcelas do contrato quanto na tela
 * "Devedores do Dia" — o fluxo de registrar pagamento é idêntico nos dois
 * lugares (mesmo cálculo de juros ao vivo, mesma forma de pagamento, mesmo
 * suporte a pagamento parcial), então fica centralizado aqui.
 *
 * "Pagamento integral" (padrão) manda o servidor quitar exatamente o que
 * estiver em aberto NO MOMENTO da confirmação — nunca o valor mostrado aqui
 * na tela, que foi calculado quando o diálogo abriu e pode ficar
 * desatualizado se o usuário demorar para confirmar (isso é o que causava
 * saldo residual tipo "R$ 0,11": o juros de atraso avança um pouco entre a
 * abertura e o envio, e o valor digitado ficava um pouco menor que o devido).
 */
export function RegisterPaymentDialog({
  installment,
  contractType,
  contractPrincipalAmount,
  triggerLabel = "Registrar pagamento",
  clientName,
  onPaid,
}: {
  installment: Installment;
  /** Venda de iPhone nunca gera juros de atraso — só empréstimo. */
  contractType: ContractType;
  /** Valor originalmente emprestado no contrato — base do juros de atraso (nunca o valor da parcela). */
  contractPrincipalAmount: number;
  triggerLabel?: string;
  /** Exibido no diálogo de confirmação — útil em telas que listam vários clientes (Devedores do Dia). */
  clientName?: string;
  onPaid?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const outstandingPrincipal = roundCents(Math.max(installment.amount - installment.paid_principal_amount, 0));
  const interestOwed = useMemo(
    () =>
      calculateLateInterest({
        contractType,
        originalPrincipalAmount: contractPrincipalAmount,
        dueDate: installment.due_date,
        status: installment.status,
        paidInterestAmount: installment.paid_interest_amount,
      }),
    [contractType, contractPrincipalAmount, installment.due_date, installment.status, installment.paid_interest_amount],
  );
  const totalDue = roundCents(outstandingPrincipal + interestOwed);

  const defaultValues: PaymentInput = {
    installmentId: installment.id,
    payInFull: true,
    amount: totalDue,
    method: "dinheiro",
    notes: "",
  };

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues,
  });

  const payInFull = watch("payInFull");

  const onSubmit = handleSubmit(async (formData) => {
    const result = await registerPayment({ ...formData, idempotencyKey });
    if (result.ok) {
      toast.success("Pagamento registrado.");
      reset(defaultValues);
      setOpen(false);
      onPaid?.();
    } else {
      toast.error(result.error ?? "Erro ao registrar pagamento.");
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setIdempotencyKey(newIdempotencyKey());
          reset({ ...defaultValues, amount: totalDue });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <WalletIcon />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento — Parcela {installment.number}</DialogTitle>
          <DialogDescription>
            {clientName && `${clientName} · `}
            Valor original da parcela: {formatCurrency(installment.amount)}
            {installment.paid_principal_amount + installment.paid_interest_amount > 0 &&
              ` · Já pago: ${formatCurrency(roundCents(installment.paid_principal_amount + installment.paid_interest_amount))}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1 rounded-md bg-muted px-3 py-2 text-sm">
          <p className="text-muted-foreground">Principal em aberto: {formatCurrency(outstandingPrincipal)}</p>
          {interestOwed > 0 && (
            <>
              <p className="text-destructive">Juros de atraso (1%/dia): {formatCurrency(interestOwed)}</p>
              <p className="text-xs text-muted-foreground">
                Calculado sobre o valor originalmente emprestado: {formatCurrency(contractPrincipalAmount)}
              </p>
            </>
          )}
          <p className="font-medium">Total devido agora: {formatCurrency(totalDue)}</p>
          <p className="text-xs text-muted-foreground">
            O valor exato é sempre conferido de novo no momento da confirmação.
          </p>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4">
          <input type="hidden" {...register("installmentId")} />

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="payInFull">Pagamento integral</Label>
              <p className="text-xs text-muted-foreground">Quita todo o saldo em aberto desta parcela.</p>
            </div>
            <Controller
              control={control}
              name="payInFull"
              render={({ field }) => (
                <Switch id="payInFull" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          {!payInFull && (
            <div className="grid gap-1.5">
              <Label htmlFor="amount">Valor pago (R$)</Label>
              <Input id="amount" type="number" step="0.01" min="0" {...register("amount", { valueAsNumber: true })} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
          )}

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
            <Input id="notes" placeholder="Ex: pagou metade hoje" {...register("notes")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
