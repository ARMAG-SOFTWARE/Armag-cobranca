"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, SendIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WHATSAPP_PROVIDER_LABELS, type MessageSettings, type WhatsAppProviderName } from "@/lib/types";
import { messageSettingsSchema, type MessageSettingsInput } from "@/lib/validations";
import { saveMessageSettings, sendTestMessage } from "@/app/actions";

// Sem saudação de propósito — tom firme e direto pedido pelo usuário:
// sem "bom dia"/"tudo bem?"/"obrigado", "favor" em vez de "por favor",
// direto na situação da parcela.
const DEFAULT_TEMPLATE =
  "Parcela {numero_parcela} pendente de pagamento.\n\nValor da parcela: R$ {valor}\nDias de atraso: {dias_atraso}\nJuros do dia: R$ {juros_dia}\nData de vencimento: {data_vencimento}\nValor atualizado da parcela: R$ {valor_atualizado}\n\nFavor enviar o comprovante de pagamento.";

const PROVIDER_FIELDS: Record<WhatsAppProviderName, { label: string; key: keyof MessageSettingsInput }[]> = {
  evolution: [
    { label: "URL base (ex: https://minha-evolution.com)", key: "baseUrl" },
    { label: "API Key", key: "apiKey" },
    { label: "Instance ID", key: "instanceId" },
  ],
  zapi: [
    { label: "URL base (ex: https://api.z-api.io)", key: "baseUrl" },
    { label: "Instance ID", key: "instanceId" },
    { label: "Token (API Key)", key: "apiKey" },
  ],
  twilio: [
    { label: "Account SID", key: "instanceId" },
    { label: "Auth Token", key: "authToken" },
    { label: "Número remetente (ex: +14155238886)", key: "senderNumber" },
  ],
  wppconnect: [
    { label: "URL base (ex: https://minha-wppconnect.com)", key: "baseUrl" },
    { label: "Sessão (Instance ID)", key: "instanceId" },
    { label: "Token (API Key)", key: "apiKey" },
  ],
  meta: [
    { label: "Phone Number ID", key: "instanceId" },
    { label: "Access Token (token de sistema, permanente)", key: "apiKey" },
    { label: "Nome do template aprovado", key: "templateName" },
    { label: "Idioma do template (ex: pt_BR)", key: "templateLanguage" },
  ],
};

export function SettingsForm({
  initialSettings,
  hasApiKey,
  hasAuthToken,
}: {
  initialSettings: MessageSettings | null;
  /** Já existe api_key salvo no servidor — o campo fica vazio aqui mesmo assim (nunca é reenviado ao navegador). */
  hasApiKey: boolean;
  /** Mesma ideia de `hasApiKey`, para o auth_token (usado só pelo Twilio). */
  hasAuthToken: boolean;
}) {
  const [testPhone, setTestPhone] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MessageSettingsInput>({
    resolver: zodResolver(messageSettingsSchema),
    defaultValues: {
      provider: initialSettings?.provider ?? "evolution",
      baseUrl: initialSettings?.base_url ?? "",
      // Nunca pré-preenchido: um segredo já salvo não é reenviado ao
      // navegador. Deixar em branco no envio mantém o valor atual (ver
      // `saveMessageSettings`); só é sobrescrito se o usuário digitar um novo.
      apiKey: "",
      instanceId: initialSettings?.instance_id ?? "",
      senderNumber: initialSettings?.sender_number ?? "",
      authToken: "",
      messageTemplate: initialSettings?.message_template ?? DEFAULT_TEMPLATE,
      templateName: initialSettings?.template_name ?? "",
      templateLanguage: initialSettings?.template_language ?? "pt_BR",
      adminAlertPhone: initialSettings?.admin_alert_phone ?? "",
    },
  });

  const provider = watch("provider");
  const fields = PROVIDER_FIELDS[provider];
  const SECRET_PLACEHOLDER: Partial<Record<keyof MessageSettingsInput, string>> = {
    apiKey: hasApiKey ? "•••••••• (já configurado — deixe em branco para manter)" : undefined,
    authToken: hasAuthToken ? "•••••••• (já configurado — deixe em branco para manter)" : undefined,
  };

  const onSubmit = handleSubmit(async (data) => {
    const result = await saveMessageSettings(data);
    if (result.ok) {
      toast.success("Configuração salva com sucesso.");
    } else {
      toast.error(result.error ?? "Erro ao salvar configuração.");
    }
  });

  async function handleTestSend() {
    if (!testPhone) {
      toast.error("Informe um telefone para o teste.");
      return;
    }
    setIsTesting(true);
    const result = await sendTestMessage(testPhone);
    setIsTesting(false);
    if (result.ok) {
      toast.success("Mensagem de teste enviada.");
    } else {
      toast.error(result.error ?? "Erro ao enviar mensagem de teste.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <SpotlightCard>
        <CardHeader>
          <CardTitle>Provedor de WhatsApp</CardTitle>
          <CardDescription>
            Escolha e configure a API responsável pelo envio das cobranças (Meta Cloud API, Evolution API, Z-API,
            Twilio ou WPPConnect).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="provider">Provedor</Label>
            <Controller
              control={control}
              name="provider"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(WHATSAPP_PROVIDER_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.key === "apiKey" || field.key === "authToken" ? "password" : "text"}
                  placeholder={SECRET_PLACEHOLDER[field.key]}
                  autoComplete="off"
                  {...register(field.key)}
                />
              </div>
            ))}
          </div>

          {provider === "meta" && (
            <div className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning">
              A Meta exige que mensagens iniciadas pela empresa usem um template pré-aprovado — texto livre só
              funciona respondendo dentro de 24h após o cliente escrever. Crie o template no Meta Business Manager
              com exatamente <strong>4 variáveis</strong>, nesta ordem: nome do cliente, parcela, valor e data de
              vencimento. O texto abaixo (&quot;Template da mensagem&quot;) é só uma referência do conteúdo — o que
              realmente é enviado é o template aprovado com esse nome.
            </div>
          )}
        </CardContent>
      </SpotlightCard>

      <SpotlightCard>
        <CardHeader>
          <CardTitle>Template da mensagem</CardTitle>
          <CardDescription>
            Use os placeholders <code>{"{nome_cliente}"}</code>, <code>{"{numero_parcela}"}</code>,{" "}
            <code>{"{valor}"}</code>, <code>{"{data_vencimento}"}</code>, <code>{"{dias_atraso}"}</code>,{" "}
            <code>{"{juros_dia}"}</code> e <code>{"{valor_atualizado}"}</code>. Mensagem sem saudação, em tom
            direto — não é adicionada nenhuma saudação automaticamente no envio.
            {provider === "meta" &&
              " Para a Meta, isto é só referência — o envio real usa o template aprovado, que só aceita as 4 variáveis originais (nome, parcela, valor, vencimento)."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea rows={4} {...register("messageTemplate")} />
          {errors.messageTemplate && (
            <p className="mt-1.5 text-xs text-destructive">{errors.messageTemplate.message}</p>
          )}
        </CardContent>
      </SpotlightCard>

      <SpotlightCard>
        <CardHeader>
          <CardTitle>Alertas de sistema</CardTitle>
          <CardDescription>
            Reaproveita o provedor de WhatsApp configurado acima para avisar você se o backup automático falhar.
            Deixe em branco se não quiser esse alerta — a notificação por e-mail do GitHub continua funcionando de
            qualquer forma.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="adminAlertPhone">Telefone para alertas (opcional)</Label>
            <Input id="adminAlertPhone" placeholder="(11) 91234-5678" {...register("adminAlertPhone")} />
          </div>
        </CardContent>
      </SpotlightCard>

      <div className="flex justify-end">
        <Button type="submit" variant="glow" disabled={isSubmitting} size="lg">
          {isSubmitting ? "Salvando..." : "Salvar configuração"}
        </Button>
      </div>

      <SpotlightCard>
        <CardHeader>
          <CardTitle>Testar envio</CardTitle>
          <CardDescription>Salve a configuração acima antes de testar.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="testPhone">Telefone para teste</Label>
            <Input
              id="testPhone"
              placeholder="(11) 91234-5678"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" onClick={handleTestSend} disabled={isTesting}>
            {isTesting ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            Enviar teste
          </Button>
        </CardContent>
      </SpotlightCard>
    </form>
  );
}
