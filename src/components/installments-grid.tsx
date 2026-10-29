"use client";

import { MessageCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InstallmentStatusBadge } from "@/components/status-badge";
import { RegisterPaymentDialog } from "@/components/register-payment-dialog";
import { RenewInstallmentDialog } from "@/components/renew-installment-dialog";
import { calculateLateInterest } from "@/lib/financial-rules";
import { type Client, type Contract, type Installment, type WhatsAppOpenMode } from "@/lib/types";
import { cn, formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { openWhatsAppUrl } from "@/lib/whatsapp-open";
import { buildWhatsAppReminderLink } from "@/lib/whatsapp-reminder-link";
import { markReminderOpened } from "@/app/actions";

type ReminderContract = Pick<
  Contract,
  | "type"
  | "principal_amount"
  | "has_down_payment"
  | "down_payment_amount"
  | "installments_count"
  | "interest_rate_percent"
  | "late_interest_rate_percent_per_day"
  | "periodicity"
>;
type ReminderClient = Pick<Client, "name" | "phone">;

function InstallmentRow({
  installment,
  contract,
  client,
  whatsappOpenMode,
}: {
  installment: Installment;
  contract: ReminderContract;
  client: ReminderClient;
  whatsappOpenMode: WhatsAppOpenMode;
}) {
  const router = useRouter();

  // Só pra decidir se mostra o botão "Renovar" — o servidor sempre
  // recalcula este valor de novo antes de gravar qualquer coisa, nunca
  // confia neste número calculado na tela.
  const interestOwed =
    installment.status !== "pago"
      ? calculateLateInterest({
          lateInterestRatePercentPerDay: contract.late_interest_rate_percent_per_day,
          originalPrincipalAmount: contract.principal_amount,
          dueDate: installment.due_date,
          status: installment.status,
          paidInterestAmount: installment.paid_interest_amount,
        })
      : 0;

  function handleSendReminder() {
    // Monta o link e abre o WhatsApp de forma síncrona, na mesma interação
    // de clique — qualquer `await` antes do `window.open` faz o navegador
    // tratar a nova aba como pop-up e bloqueá-la.
    const result = buildWhatsAppReminderLink(client, contract, installment, whatsappOpenMode);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    openWhatsAppUrl(result.url);
    toast.success("WhatsApp aberto com a mensagem preenchida. Confira e envie por lá.");

    // Best-effort: só registra que o lembrete foi iniciado (não comprova
    // envio nem entrega). Nunca bloqueia nem desfaz a abertura do WhatsApp.
    void markReminderOpened(installment.id);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between",
        installment.status === "atrasado" && "border-destructive/30",
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">
            Parcela {installment.number}/{contract.installments_count}
          </span>
          <InstallmentStatusBadge status={installment.status} />
        </div>
        <span className="text-sm text-muted-foreground">
          {formatCurrency(installment.amount)} · Vencimento: {formatDate(installment.due_date)}
        </span>
        {installment.paid_principal_amount + installment.paid_interest_amount > 0 && installment.status !== "pago" && (
          <span className="text-xs text-muted-foreground">
            Pago parcialmente: {formatCurrency(installment.paid_principal_amount + installment.paid_interest_amount)}
          </span>
        )}
        {installment.reminder_sent_at && (
          <span className="text-xs text-muted-foreground">
            Último lembrete iniciado em {formatDateTime(installment.reminder_sent_at)} ({installment.reminder_count}x)
            — isso só confirma que o WhatsApp foi aberto, não que a mensagem foi enviada.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {installment.status !== "pago" && (
          <RegisterPaymentDialog
            installment={installment}
            lateInterestRatePercentPerDay={contract.late_interest_rate_percent_per_day}
            contractPrincipalAmount={contract.principal_amount}
            onPaid={() => router.refresh()}
          />
        )}

        {contract.type === "emprestimo" && interestOwed > 0 && (
          <RenewInstallmentDialog
            installmentId={installment.id}
            installmentLabel={`parcela ${installment.number}/${contract.installments_count}`}
            interestOwed={interestOwed}
            dueDate={installment.due_date}
            periodicity={contract.periodicity}
          />
        )}

        <Button
          type="button"
          variant={installment.status === "atrasado" ? "glow" : "outline"}
          size="sm"
          disabled={installment.status === "pago"}
          onClick={handleSendReminder}
        >
          <MessageCircleIcon />
          Enviar Lembrete
        </Button>
      </div>
    </div>
  );
}

export function InstallmentsGrid({
  installments,
  contract,
  client,
  whatsappOpenMode = "padrao",
}: {
  installments: Installment[];
  contract: ReminderContract;
  client: ReminderClient;
  whatsappOpenMode?: WhatsAppOpenMode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {installments.map((installment) => (
        <InstallmentRow
          key={installment.id}
          installment={installment}
          contract={contract}
          client={client}
          whatsappOpenMode={whatsappOpenMode}
        />
      ))}
    </div>
  );
}
