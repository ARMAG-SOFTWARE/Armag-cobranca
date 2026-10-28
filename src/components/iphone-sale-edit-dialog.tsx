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
import type { IphoneSale } from "@/lib/iphone-sales";
import { iphoneSaleUpdateSchema, type IphoneSaleUpdateInput } from "@/lib/validations";
import { updateIphoneSale } from "@/app/actions";

export function IphoneSaleEditDialog({ sale }: { sale: IphoneSale }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const hasPayments = sale.received > 0;

  const defaultValues: IphoneSaleUpdateInput = {
    model: sale.phone.model,
    color: sale.phone.color ?? "",
    batteryPercent: sale.phone.battery_percent ?? undefined,
    costAmount: sale.phone.cost_amount,
    saleAmount: sale.contract.principal_amount,
    imei: sale.phone.imei ?? "",
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<IphoneSaleUpdateInput>({
    resolver: zodResolver(iphoneSaleUpdateSchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async (data) => {
    const result = await updateIphoneSale(sale.contract.id, data);
    if (result.ok) {
      toast.success("Venda atualizada.");
      reset(data);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao atualizar venda.");
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
          <PencilIcon />
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar venda</DialogTitle>
          <DialogDescription>
            Modelo, cor, bateria e custo sempre podem ser corrigidos.
            {hasPayments
              ? " Esta venda já tem pagamento registrado, então o valor da venda não pode mais ser alterado."
              : " Como ainda não há pagamento registrado, o valor da venda também pode ser corrigido."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="model">Produto</Label>
            <Input id="model" placeholder="Ex: iPhone 16 Pro, Sofá 3 lugares" {...register("model")} />
            {errors.model && <p className="text-xs text-destructive">{errors.model.message}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="color">Cor</Label>
              <Input id="color" placeholder="Ex: Titânio Natural" {...register("color")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="batteryPercent">Saúde da bateria (%)</Label>
              <Input
                id="batteryPercent"
                type="number"
                min="0"
                max="100"
                placeholder="Ex: 92"
                {...register("batteryPercent", { valueAsNumber: true })}
              />
              {errors.batteryPercent && <p className="text-xs text-destructive">{errors.batteryPercent.message}</p>}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="costAmount">Custo do produto (R$)</Label>
              <Input
                id="costAmount"
                type="number"
                step="0.01"
                min="0"
                {...register("costAmount", { valueAsNumber: true })}
              />
              {errors.costAmount && <p className="text-xs text-destructive">{errors.costAmount.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="saleAmount">Valor da venda (R$)</Label>
              <Input
                id="saleAmount"
                type="number"
                step="0.01"
                min="0"
                disabled={hasPayments}
                {...register("saleAmount", { valueAsNumber: true })}
              />
              {errors.saleAmount && <p className="text-xs text-destructive">{errors.saleAmount.message}</p>}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="imei">IMEI do aparelho (opcional, só para celulares)</Label>
            <Input id="imei" placeholder="15 dígitos" {...register("imei")} />
            {errors.imei && <p className="text-xs text-destructive">{errors.imei.message}</p>}
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
