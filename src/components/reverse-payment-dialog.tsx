"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2Icon } from "lucide-react";

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
import { PAYMENT_METHOD_LABELS, type Payment } from "@/lib/types";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { reversePayment } from "@/app/actions";

/**
 * Estorno de um pagamento lançado errado — devolve o valor à parcela e
 * apaga o pagamento. Só é oferecido para o pagamento mais recente de cada
 * parcela (a regra é conferida de novo no servidor).
 */
export function ReversePaymentDialog({
  payment,
  label,
}: {
  payment: Pick<Payment, "id" | "principal_amount" | "interest_amount" | "method" | "paid_at">;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const router = useRouter();
  const total = payment.principal_amount + payment.interest_amount;

  async function handleConfirm() {
    setIsReversing(true);
    const result = await reversePayment(payment.id);
    setIsReversing(false);

    if (result.ok) {
      toast.success("Pagamento estornado.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao estornar pagamento.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
          <Undo2Icon />
          Estornar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Estornar pagamento?</DialogTitle>
          <DialogDescription>
            Use quando o pagamento foi lançado errado. O valor volta a ficar em aberto na parcela e o registro do
            pagamento é removido. Essa ação não poderá ser desfeita.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-3 rounded-md bg-muted px-3 py-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Referente a</dt>
            <dd className="font-medium">{label}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Valor</dt>
            <dd className="font-medium">{formatCurrency(total)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Forma</dt>
            <dd className="font-medium">{PAYMENT_METHOD_LABELS[payment.method]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Data</dt>
            <dd className="font-medium">{formatDateTime(payment.paid_at)}</dd>
          </div>
        </dl>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" disabled={isReversing} onClick={handleConfirm}>
            {isReversing ? "Estornando..." : "Confirmar estorno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
