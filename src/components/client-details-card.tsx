"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileTextIcon, PencilIcon, TrashIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SpotlightCard } from "@/components/ui/spotlight-card";
import type { Client } from "@/lib/types";
import { clientAddressSchema, type ClientAddressInput } from "@/lib/validations";
import { deleteClientDocument, updateClientAddress, uploadClientDocument } from "@/app/actions";

function formatAddress(client: Client) {
  const line1 = [client.street, client.street_number].filter(Boolean).join(", ");
  const line2 = [client.neighborhood, client.city, client.state].filter(Boolean).join(", ");
  const parts = [line1, line2, client.zip_code].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : null;
}

function EditAddressDialog({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const defaultValues: ClientAddressInput = {
    street: client.street ?? "",
    streetNumber: client.street_number ?? "",
    neighborhood: client.neighborhood ?? "",
    city: client.city ?? "",
    state: client.state ?? "",
    zipCode: client.zip_code ?? "",
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClientAddressInput>({
    resolver: zodResolver(clientAddressSchema),
    defaultValues,
  });

  const onSubmit = handleSubmit(async (data) => {
    const result = await updateClientAddress(client.id, data);
    if (result.ok) {
      toast.success("Endereço atualizado.");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao salvar endereço.");
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
          Editar endereço
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Endereço do cliente</DialogTitle>
          <DialogDescription>{client.name}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="street">Rua</Label>
              <Input id="street" {...register("street")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="streetNumber">Número</Label>
              <Input id="streetNumber" {...register("streetNumber")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="neighborhood">Bairro</Label>
            <Input id="neighborhood" {...register("neighborhood")} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" {...register("city")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="state">UF</Label>
              <Input id="state" placeholder="SP" maxLength={2} {...register("state")} />
              {errors.state && <p className="text-xs text-destructive">{errors.state.message}</p>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="zipCode">CEP</Label>
            <Input id="zipCode" placeholder="00000-000" {...register("zipCode")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar endereço"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocumentSection({
  clientId,
  documentSignedUrl,
}: {
  clientId: string;
  documentSignedUrl: string | null;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Selecione um arquivo primeiro.");
      return;
    }

    const formData = new FormData();
    formData.set("file", file);

    setIsUploading(true);
    const result = await uploadClientDocument(clientId, formData);
    setIsUploading(false);

    if (result.ok) {
      toast.success("Documento enviado.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsReplacing(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao enviar documento.");
    }
  }

  async function handleRemove() {
    if (!confirm("Remover o documento deste cliente?")) return;
    setIsRemoving(true);
    const result = await deleteClientDocument(clientId);
    setIsRemoving(false);

    if (result.ok) {
      toast.success("Documento removido.");
      router.refresh();
    } else {
      toast.error(result.error ?? "Erro ao remover documento.");
    }
  }

  if (documentSignedUrl) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={documentSignedUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <FileTextIcon className="size-4" />
            Ver documento
          </a>
          <Button type="button" variant="outline" size="sm" onClick={() => setIsReplacing((v) => !v)}>
            <UploadIcon />
            Substituir
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={isRemoving} onClick={handleRemove}>
            <TrashIcon />
            Remover
          </Button>
        </div>
        {isReplacing && (
          <div className="flex flex-wrap items-center gap-2">
            <Input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="max-w-xs" />
            <Button type="button" size="sm" disabled={isUploading} onClick={handleUpload}>
              <UploadIcon />
              {isUploading ? "Enviando..." : "Enviar novo documento"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="max-w-xs" />
      <Button type="button" size="sm" disabled={isUploading} onClick={handleUpload}>
        <UploadIcon />
        {isUploading ? "Enviando..." : "Enviar documento"}
      </Button>
    </div>
  );
}

export function ClientDetailsCard({
  client,
  documentSignedUrl,
}: {
  client: Client;
  documentSignedUrl: string | null;
}) {
  const address = formatAddress(client);

  return (
    <SpotlightCard>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Endereço e documento</CardTitle>
        <EditAddressDialog client={client} />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Endereço</p>
          <p className="mt-1 text-sm">{address ?? "Nenhum endereço cadastrado."}</p>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Documento (privado)
          </p>
          <DocumentSection clientId={client.id} documentSignedUrl={documentSignedUrl} />
        </div>
      </CardContent>
    </SpotlightCard>
  );
}
