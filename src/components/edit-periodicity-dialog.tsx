"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClockIcon } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Periodicity } from "@/lib/types";
import { PERIODICITY_LABELS } from "@/lib/types";
import { contractPeriodicitySchema, type ContractPeriodicityInput } from "@/lib/validations";
import { updateContractPeriodicity } from "@/app/actions";

/**
 * Corrige a periodicidade cadastrada errada (ex.: marcado mensal, combinado
 * era semanal) — funciona mesmo com parcela já paga: o servidor nunca
 * altera a data de uma parcela que já tem pagamento aplicado, só reencaixa
 * as que ainda estão em aberto a partir da nova periodicidade.
 */
export function EditPeriodicityDialog({
  contractId,
  currentPeriodicity,
  hasLockedInstallments,
}: {
  contractId: string;
  currentPeriodicity: Periodicity;
  /** Se há pelo menos uma parcela com algum pagamento aplicado — só para o aviso abaixo, nunca bloqueia o formulário. */
  hasLockedInstallments: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const defaultValues: ContractPeriodicityInput = { periodicity: currentPeriodicity };

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<ContractPeriodicityInput>({
    resolver: zodResolver(contractPeriodicitySchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async (data) => {
    const result = await updateContractPeriodicity(contractId, data);
    if (result.ok) {
      toast.success("Periodicidade atualizada.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao atualizar periodicidade.");
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(defaultValues);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <CalendarClockIcon />
          Periodicidade
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Periodicidade das parcelas</DialogTitle>
          <DialogDescription>
            Corrige a periodicidade cadastrada por engano.
            {hasLockedInstallments
              ? " Parcelas que já têm pagamento (total ou parcial) não mudam de data — só as ainda em aberto são reorganizadas a partir delas, na nova periodicidade."
              : " As datas de vencimento são recalculadas a partir do 1º vencimento já definido."}{" "}
            O valor total e a quantidade de parcelas não mudam.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="periodicity">Periodicidade</Label>
            <Controller
              control={control}
              name="periodicity"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="periodicity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diaria">{PERIODICITY_LABELS.diaria}</SelectItem>
                    <SelectItem value="semanal">{PERIODICITY_LABELS.semanal}</SelectItem>
                    <SelectItem value="quinzenal">{PERIODICITY_LABELS.quinzenal}</SelectItem>
                    <SelectItem value="mensal">{PERIODICITY_LABELS.mensal}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
