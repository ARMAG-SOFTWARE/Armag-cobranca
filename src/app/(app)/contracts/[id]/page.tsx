import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, MessageCircleIcon } from "lucide-react";

import { ClientDetailsCard } from "@/components/client-details-card";
import { CopyButton } from "@/components/copy-button";
import { DeleteContractDialog } from "@/components/delete-contract-dialog";
import { DisbursementDialog } from "@/components/disbursement-dialog";
import { EditClientInfoDialog } from "@/components/edit-client-info-dialog";
import { InstallmentsGrid } from "@/components/installments-grid";
import { PaymentHistory } from "@/components/payment-history";
import { SettleContractDialog } from "@/components/settle-contract-dialog";
import { ContractStatusBadge, ContractTypeBadge } from "@/components/status-badge";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { getClientDocumentSignedUrl } from "@/lib/client-documents";
import { createClient } from "@/lib/supabase/server";
import { calculateFinancedAmount, roundCents } from "@/lib/financial-rules";
import { PERIODICITY_LABELS, type ContractWithInstallments, type Payment, type Phone } from "@/lib/types";
import { formatCurrency, formatDate, formatPhone, initials, toWhatsAppDigits } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // As três consultas só dependem do `id` da URL — disparadas juntas, numa
  // única rodada de ida-e-volta ao banco, em vez de uma esperar a outra.
  const [{ data, error }, { data: paymentsData }, { data: linkedPhoneData }] = await Promise.all([
    supabase.from("contracts").select("*, client:clients(*), installments(*)").eq("id", id).single(),
    supabase.from("payments").select("*").eq("contract_id", id).order("paid_at", { ascending: false }),
    supabase.from("phones").select("*").eq("contract_id", id).maybeSingle(),
  ]);

  if (error || !data) {
    notFound();
  }

  const contract = data as ContractWithInstallments;
  const installments = [...contract.installments].sort((a, b) => a.number - b.number);
  const paidCount = installments.filter((i) => i.status === "pago").length;
  const whatsappDigits = toWhatsAppDigits(contract.client.phone);

  const { markupAmount, ratePercent } = calculateFinancedAmount({
    contractType: contract.type,
    principalAmount: contract.principal_amount,
    installmentsCount: contract.installments_count,
    hasDownPayment: contract.has_down_payment,
    downPaymentAmount: contract.down_payment_amount,
    interestRatePercentPerInstallment: contract.interest_rate_percent,
  });

  // Valor da parcela lido da parcela real já persistida (não recalculado do
  // zero), garantindo que a tela mostre exatamente o que foi cobrado — a
  // última parcela pode diferir em centavos por causa do arredondamento.
  const representativeInstallmentAmount = installments[0]?.amount ?? 0;

  const payments = (paymentsData ?? []) as Payment[];
  const installmentNumberById = Object.fromEntries(installments.map((i) => [i.id, i.number]));

  const linkedPhone = linkedPhoneData as Phone | null;
  const phoneProfit =
    linkedPhone && linkedPhone.sale_amount !== null
      ? roundCents(linkedPhone.sale_amount - linkedPhone.cost_amount)
      : null;

  const documentSignedUrl = await getClientDocumentSignedUrl(supabase, contract.client.document_photo_path);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/clientes"
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Voltar para clientes
      </Link>

      <SpotlightCard>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent-cyan text-sm font-bold text-primary-foreground">
              {initials(contract.client.name)}
            </span>
            <div>
              <CardTitle className="text-xl">{contract.client.name}</CardTitle>
              {whatsappDigits ? (
                <a
                  href={`https://wa.me/${whatsappDigits}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <MessageCircleIcon className="size-4" />
                  {formatPhone(contract.client.phone)}
                </a>
              ) : (
                <span className="mt-1 inline-flex items-center gap-1.5 text-sm text-destructive">
                  <MessageCircleIcon className="size-4" />
                  {formatPhone(contract.client.phone)} (telefone inválido)
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ContractStatusBadge status={contract.status} />
            <EditClientInfoDialog client={contract.client} />
            {contract.status !== "quitado" && contract.status !== "cancelado" && (
              <SettleContractDialog contractId={contract.id} />
            )}
            <DeleteContractDialog contract={contract} clientName={contract.client.name} />
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Tipo</dt>
              <dd className="font-medium">
                <ContractTypeBadge type={contract.type} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{contract.type === "emprestimo" ? "Valor emprestado" : "Valor do produto"}</dt>
              <dd className="font-medium">{formatCurrency(contract.principal_amount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Parcelas</dt>
              <dd className="font-medium">
                {paidCount}/{contract.installments_count} pagas
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Periodicidade</dt>
              <dd className="font-medium">{PERIODICITY_LABELS[contract.periodicity]}</dd>
            </div>
            {contract.has_down_payment && (
              <div>
                <dt className="text-muted-foreground">Entrada</dt>
                <dd className="font-medium">{formatCurrency(contract.down_payment_amount)}</dd>
              </div>
            )}
            {contract.type === "emprestimo" ? (
              <>
                <div>
                  <dt className="text-muted-foreground">Juros por parcela</dt>
                  <dd className="font-medium">{contract.interest_rate_percent}%</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Juros acumulado</dt>
                  <dd className="font-medium">{ratePercent}%</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Valor dos juros</dt>
                  <dd className="font-medium">{formatCurrency(markupAmount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Valor da parcela</dt>
                  <dd className="font-semibold text-accent-cyan">{formatCurrency(representativeInstallmentAmount)}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt className="text-muted-foreground">{contract.type === "emprestimo" ? "Total a receber" : "Total previsto"}</dt>
              <dd className="font-semibold text-accent-cyan">{formatCurrency(contract.total_amount)}</dd>
            </div>
            {contract.description && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-muted-foreground">Descrição</dt>
                <dd className="font-medium">{contract.description}</dd>
              </div>
            )}
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-muted-foreground">1º vencimento</dt>
              <dd className="font-medium">{formatDate(contract.first_due_date)}</dd>
            </div>
            {contract.type === "emprestimo" && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-muted-foreground">Dinheiro emprestado</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  {contract.disbursed_at ? (
                    <span className="font-medium text-success">Já saiu da conta em {formatDate(contract.disbursed_at)}</span>
                  ) : (
                    <span className="font-medium text-warning">Ainda vai sair — não debitado do saldo geral</span>
                  )}
                  <DisbursementDialog contractId={contract.id} disbursedAt={contract.disbursed_at} />
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </SpotlightCard>

      <ClientDetailsCard client={contract.client} documentSignedUrl={documentSignedUrl} />

      {linkedPhone && (
        <SpotlightCard>
          <CardHeader>
            <CardTitle className="text-base">Detalhes do produto vendido</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Modelo</dt>
                <dd className="font-medium">{linkedPhone.model}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cor</dt>
                <dd className="font-medium">{linkedPhone.color ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Saúde da bateria</dt>
                <dd className="font-medium">
                  {linkedPhone.battery_percent !== null ? `${linkedPhone.battery_percent}%` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Custo do produto</dt>
                <dd className="font-medium">{formatCurrency(linkedPhone.cost_amount)}</dd>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-muted-foreground">IMEI</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  {linkedPhone.imei ? (
                    <>
                      <span className="font-mono font-medium">{linkedPhone.imei}</span>
                      <CopyButton value={linkedPhone.imei} label="Copiar IMEI" />
                    </>
                  ) : (
                    <span className="font-medium text-muted-foreground">Não informado</span>
                  )}
                </dd>
              </div>
              {phoneProfit !== null && (
                <div>
                  <dt className="text-muted-foreground">{phoneProfit >= 0 ? "Lucro" : "Prejuízo"} na venda</dt>
                  <dd className={phoneProfit >= 0 ? "font-semibold text-success" : "font-semibold text-destructive"}>
                    {formatCurrency(Math.abs(phoneProfit))}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </SpotlightCard>
      )}

      <div>
        <h2 className="mb-3 text-lg font-bold tracking-tight text-foreground">Parcelas</h2>
        <InstallmentsGrid installments={installments} contract={contract} client={contract.client} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Histórico de pagamentos</h2>
        <PaymentHistory
          payments={payments}
          installmentNumberById={installmentNumberById}
          totalInstallments={contract.installments_count}
        />
      </div>
    </main>
  );
}
