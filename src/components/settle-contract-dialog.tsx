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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { settleContractSchema, type SettleContractInput } from "@/lib/validations";
import {
  getContractSettlementSummary,
  payDownContractBalance,
  settleContract,
  type ContractSettlementSummary,
} from "@/app/actions";

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Lida com as duas pontas de "mexer no saldo de uma dívida" (contrato) de
 * uma vez — o valor recebido é sempre distribuído pelas parcelas ainda em
 * aberto (mais antiga primeiro, principal antes do juros), mas o que
 * acontece com o que sobra sem cobertura depende do interruptor
 * "Perdoar o restante":
 *
 * - Desligado (padrão): ABATIMENTO — reduz o saldo pelo valor recebido;
 *   o que não for coberto continua em aberto, cobrável normalmente (a
 *   dívida só fecha sozinha se o valor cobrir tudo).
 * - Ligado: QUITAÇÃO TOTAL — encerra a dívida mesmo que o valor recebido
 *   seja menor que o saldo, perdoando a diferença (acordo).
 *
 * A prévia (saldo devedor, total já pago) é sempre recarregada do servidor
 * quando o diálogo abre, nunca um número já calculado em outra tela que
 * possa estar desatualizado.
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
  const [forgiveRemainder, setForgiveRemainder] = useState(false);

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
    setForgiveRemainder(false);
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
    // Só faz sentido perdoar algo se de fato sobrar saldo sem cobertura —
    // com valor igual/maior ao saldo devedor, as duas ações dão no mesmo
    // resultado (fecha tudo, nada perdoado), então usa sempre o abatimento
    // (caminho mais simples: um pagamento por parcela, igual a um pagamento
    // normal, em vez de um evento de quitação).
    const willForgive = forgiveRemainder && summary !== null && data.amountReceived < summary.outstandingBalance;
    const action = willForgive ? settleContract : payDownContractBalance;
    const result = await action(contractId, { ...data, idempotencyKey });
    if (result.ok) {
      toast.success(willForgive ? "Dívida quitada com sucesso." : "Pagamento registrado e saldo atualizado.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao processar a operação.");
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
          <DialogTitle>{forgiveRemainder ? "Quitação total da dívida" : "Abater valor da dívida"}</DialogTitle>
          <DialogDescription>
            {forgiveRemainder
              ? "Encerra a dívida registrando o valor realmente recebido — a diferença para o saldo devedor é perdoada (acordo)."
              : "Reduz o saldo devedor pelo valor recebido. Se não cobrir tudo, o restante continua em aberto normalmente."}
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
                  {!forgiveRemainder &&
                    " Um valor menor que o saldo abate só essa parte — o restante continua em aberto."}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div>
                  <Label htmlFor="forgiveRemainder">Perdoar o restante e encerrar a dívida</Label>
                  <p className="text-xs text-muted-foreground">
                    Só importa se o valor for menor que o saldo devedor. Desligado (padrão): só abate o saldo, sem
                    perdoar nada.
                  </p>
                </div>
                <Switch id="forgiveRemainder" checked={forgiveRemainder} onCheckedChange={setForgiveRemainder} />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="notes">Observação {forgiveRemainder ? "/ justificativa do acordo " : ""}(opcional)</Label>
                <Textarea id="notes" rows={2} placeholder="Ex: acordo por pagamento à vista" {...register("notes")} />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2Icon className="animate-spin" />}
                  {isSubmitting ? "Salvando..." : forgiveRemainder ? "Confirmar quitação" : "Confirmar abatimento"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
