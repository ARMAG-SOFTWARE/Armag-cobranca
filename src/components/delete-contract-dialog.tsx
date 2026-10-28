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
import { CONTRACT_STATUS_LABELS, type Contract } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { deleteContract } from "@/app/actions";

type ContractSummary = Pick<
  Contract,
  "id" | "type" | "principal_amount" | "installments_count" | "total_amount" | "status"
>;

export function DeleteContractDialog({ contract, clientName }: { contract: ContractSummary; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();
  const isSale = contract.type === "venda_iphone";
  const operationLabel = isSale ? "venda" : "empréstimo";

  async function handleConfirm() {
    setIsDeleting(true);
    const result = await deleteContract(contract.id);
    setIsDeleting(false);

    if (result.ok) {
      toast.success(isSale ? "Venda excluída." : "Empréstimo excluído.");
      setOpen(false);
      router.push(isSale ? "/phones" : "/");
      router.refresh();
    } else {
      toast.error(result.error ?? `Erro ao excluir ${operationLabel}.`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          <TrashIcon />
          Excluir {operationLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir {operationLabel}?</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja excluir {isSale ? "esta venda" : "este empréstimo"}? Esta ação removerá o registro
            e os dados relacionados que dependem dele. Essa ação não poderá ser desfeita.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-3 rounded-md bg-muted px-3 py-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Cliente</dt>
            <dd className="font-medium">{clientName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{isSale ? "Valor da venda" : "Valor emprestado"}</dt>
            <dd className="font-medium">{formatCurrency(contract.principal_amount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Parcelas</dt>
            <dd className="font-medium">{contract.installments_count}x</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Valor total</dt>
            <dd className="font-medium">{formatCurrency(contract.total_amount)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium">{CONTRACT_STATUS_LABELS[contract.status]}</dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          Se já houver algum pagamento registrado, ele não será apagado — o sistema mantém o histórico financeiro e
          apenas marca {isSale ? "a venda" : "o empréstimo"} como cancelado(a), removendo-o(a) de todos os
          indicadores e pendências.
        </p>

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
