"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, MailIcon } from "lucide-react";
import { toast } from "sonner";

import { requestPasswordReset } from "@/app/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordResetRequestSchema, type PasswordResetRequestInput } from "@/lib/validations";

export function PasswordResetRequestForm() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequestInput>({
    resolver: zodResolver(passwordResetRequestSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    const result = await requestPasswordReset(data);
    if (result.ok) {
      setSent(true);
    } else {
      toast.error(result.error ?? "Erro ao enviar o e-mail.");
    }
  });

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        Se este e-mail tiver uma conta, você vai receber um link para criar uma nova senha. Confira também a caixa de
        spam.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="email">E-mail da conta</Label>
        <Input id="email" type="email" placeholder="voce@email.com" autoComplete="email" {...register("email")} />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      <Button type="submit" variant="glow" size="lg" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
        {isSubmitting ? "Enviando..." : "Enviar link"}
      </Button>
    </form>
  );
}
