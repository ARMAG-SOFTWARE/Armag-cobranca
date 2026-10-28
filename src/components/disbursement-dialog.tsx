"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon } from "lucide-react";
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
import { getBusinessToday } from "@/lib/date-utils";
import { contractDisbursementSchema, type ContractDisbursementInput } from "@/lib/validations";
import { updateContractDisbursement } from "@/app/actions";

/**
 * Edita manualmente se/quando o dinheiro de um empréstimo já saiu de fato
 * da conta (item do fluxo de caixa pedido pelo cliente) — nunca inferido
 * automaticamente. Deixar a data em branco volta o contrato para "ainda
 * vai sair", tirando o valor do saldo geral de caixa até confirmar de
 * novo.
 */
export function DisbursementDialog({
  contractId,
  disbursedAt,
}: {
  contractId: string;
  disbursedAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const defaultValues: ContractDisbursementInput = { disbursedAt: disbursedAt ?? "" };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { isSubmitting, isDirty },
  } = useForm<ContractDisbursementInput>({
    resolver: zodResolver(contractDisbursementSchema),
    defaultValues,
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset(defaultValues);
  }

  const onSubmit = handleSubmit(async (data) => {
    const result = await updateContractDisbursement(contractId, data);
    if (result.ok) {
      toast.success(data.disbursedAt ? "Saída do dinheiro confirmada." : "Marcado como \"ainda vai sair\".");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao salvar.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PencilIcon />
          {disbursedAt ? "Editar saída" : "Marcar saída"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Saída do dinheiro</DialogTitle>
          <DialogDescription>
            Informe a data em que este dinheiro realmente saiu da sua conta. Deixe em branco se ainda não saiu — o
            saldo geral de caixa só é debitado depois que uma data for confirmada aqui.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="disbursedAt">Data da saída (opcional)</Label>
            <Input id="disbursedAt" type="date" max={getBusinessToday()} {...register("disbursedAt")} />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setValue("disbursedAt", "", { shouldDirty: true })}
            >
              Limpar (ainda vai sair)
            </Button>
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
