"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import type { EffectiveBusinessSettings } from "@/lib/business-settings";
import { businessSettingsSchema, type BusinessSettingsInput } from "@/lib/validations";
import { WHATSAPP_OPEN_MODE_LABELS } from "@/lib/whatsapp-open";
import { saveBusinessSettings } from "@/app/actions";

export function BusinessSettingsForm({ initialSettings }: { initialSettings: EffectiveBusinessSettings }) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BusinessSettingsInput>({
    resolver: zodResolver(businessSettingsSchema),
    defaultValues: {
      lateInterestRatePercentPerDay: initialSettings.lateInterestRatePercentPerDay,
      whatsappOpenMode: initialSettings.whatsappOpenMode,
      businessWhatsappNumber: initialSettings.businessWhatsappNumber ?? "",
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    const result = await saveBusinessSettings(data);
    if (result.ok) {
      toast.success("Configurações salvas.");
    } else {
      toast.error(result.error ?? "Erro ao salvar configurações.");
    }
  });

  return (
    <form onSubmit={onSubmit}>
      <SpotlightCard>
        <CardHeader>
          <CardTitle>Regras de cobrança</CardTitle>
          <CardDescription>
            Juros de atraso usado nos novos contratos e como o botão de cobrança abre o WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="lateInterestRatePercentPerDay">Juros de atraso (% ao dia)</Label>
            <Input
              id="lateInterestRatePercentPerDay"
              type="number"
              step="0.01"
              min="0"
              {...register("lateInterestRatePercentPerDay", { valueAsNumber: true })}
            />
            {errors.lateInterestRatePercentPerDay && (
              <p className="text-xs text-destructive">{errors.lateInterestRatePercentPerDay.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Sobre o valor total do contrato, para empréstimos e vendas. Vale para os contratos cadastrados daqui
              em diante — os já existentes mantêm a taxa com que foram criados.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="whatsappOpenMode">Abrir a cobrança no</Label>
              <Controller
                control={control}
                name="whatsappOpenMode"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="whatsappOpenMode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(WHATSAPP_OPEN_MODE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="businessWhatsappNumber">Número do WhatsApp Business (opcional)</Label>
              <Input
                id="businessWhatsappNumber"
                inputMode="tel"
                placeholder="(11) 91234-5678"
                {...register("businessWhatsappNumber")}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            No Android, &quot;WhatsApp Business&quot; abre sempre o app Business, nunca o pessoal. No iPhone/iPad não é
            possível escolher o app pelo link: use &quot;WhatsApp Web&quot; com o navegador logado na conta Business, ou
            deixe só o WhatsApp Business instalado no aparelho da cobrança.
          </p>

          <div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="size-4 animate-spin" />}
              Salvar regras de cobrança
            </Button>
          </div>
        </CardContent>
      </SpotlightCard>
    </form>
  );
}
