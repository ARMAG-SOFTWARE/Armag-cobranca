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
import { MaskedInput } from "@/components/ui/masked-input";
import { maskPhone } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Client } from "@/lib/types";
import { clientInfoSchema, type ClientInfoInput } from "@/lib/validations";
import { updateClientInfo } from "@/app/actions";

export function EditClientInfoDialog({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const defaultValues: ClientInfoInput = {
    name: client.name,
    phone: maskPhone(client.phone),
    email: client.email ?? "",
    notes: client.notes ?? "",
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ClientInfoInput>({
    resolver: zodResolver(clientInfoSchema),
    defaultValues,
  });

  function handleOpenChange(next: boolean) {
    if (!next && isDirty) {
      if (!confirm("Descartar as alterações não salvas?")) return;
    }
    setOpen(next);
    if (!next) {
      reset(defaultValues);
    }
  }

  const onSubmit = handleSubmit(async (data) => {
    const result = await updateClientInfo(client.id, data);
    if (result.ok) {
      toast.success("Dados do cliente atualizados.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao salvar os dados do cliente.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PencilIcon />
          Editar cliente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
          <DialogDescription>Altere os dados cadastrais. Empréstimos e pagamentos não são afetados.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="client-name">Nome completo</Label>
            <Input id="client-name" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="client-phone">Telefone / WhatsApp</Label>
            <MaskedInput mask="phone" id="client-phone" placeholder="(11) 91234-5678" {...register("phone")} />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="client-email">E-mail (opcional)</Label>
            <Input id="client-email" type="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="client-notes">Observações (opcional)</Label>
            <Textarea id="client-notes" rows={3} {...register("notes")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
