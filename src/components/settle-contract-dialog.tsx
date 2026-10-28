"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { HandCoinsIcon, Loader2Icon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { settleContractSchema, type SettleContractInput } from "@/lib/validations";
import { getContractSettlementSummary, settleContract, type ContractSettlementSummary } from "@/app/actions";

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Quitação total de UMA dívida (contrato) por um valor possivelmente
 * diferente do saldo devedor atual — fecha todas as parcelas restantes de
 * uma vez, registrando no histórico exatamente o valor recebido (nunca o
 * saldo anterior). A prévia (saldo devedor, total já pago) é sempre
 * recarregada do servidor quando o diálogo abre, nunca um número já
 * calculado em outra tela que possa estar desatualizado.
 */
export function SettleContractDialog({
  contractId,
  triggerLabel = "Quitar dívida",
}: {
  contractId: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ContractSettlementSummary | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SettleContractInput>({
    resolver: zodResolver(settleContractSchema),
    defaultValues: { amountReceived: 0, notes: "" },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;

    setIdempotencyKey(newIdempotencyKey());
    setLoading(true);
    setSummary(null);
    getContractSettlementSummary(contractId).then((result) => {
      setLoading(false);
      if (result.ok) {
        setSummary(result.summary);
        reset({ amountReceived: result.summary.outstandingBalance, notes: "" });
      } else {
        toast.error(result.error);
        setOpen(false);
      }
    });
  }

  const onSubmit = handleSubmit(async (data) => {
    const result = await settleContract(contractId, { ...data, idempotencyKey });
    if (result.ok) {
      toast.success("Dívida quitada com sucesso.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao quitar a dívida.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <HandCoinsIcon />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quitação total da dívida</DialogTitle>
          <DialogDescription>
            Encerra a dívida registrando o valor realmente recebido — pode ser diferente do saldo devedor, em caso de
            acordo.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando dados da dívida...</p>
        ) : summary && !summary.canSettle ? (
          <p className="py-6 text-center text-sm text-destructive">{summary.reasonCannotSettle}</p>
        ) : summary ? (
          <>
            <div className="grid gap-1 rounded-md bg-muted px-3 py-2 text-sm">
              <p className="font-medium">
                {summary.clientName} · {summary.contractLabel}
              </p>
              <p className="text-muted-foreground">Valor original: {formatCurrency(summary.originalAmount)}</p>
              <p className="text-muted-foreground">Total já pago: {formatCurrency(summary.totalPaid)}</p>
              <p className="font-medium">Saldo devedor atual: {formatCurrency(summary.outstandingBalance)}</p>
            </div>

            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="amountReceived">Valor efetivamente recebido (R$)</Label>
                <Input
                  id="amountReceived"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={summary.outstandingBalance}
                  {...register("amountReceived", { valueAsNumber: true })}
                />
                {errors.amountReceived && <p className="text-xs text-destructive">{errors.amountReceived.message}</p>}
                <p className="text-xs text-muted-foreground">
                  Não pode ultrapassar o saldo devedor atual ({formatCurrency(summary.outstandingBalance)}).
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="notes">Observação / justificativa do acordo (opcional)</Label>
                <Textarea id="notes" rows={2} placeholder="Ex: acordo por pagamento à vista" {...register("notes")} />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2Icon className="animate-spin" />}
                  {isSubmitting ? "Quitando..." : "Confirmar quitação"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
