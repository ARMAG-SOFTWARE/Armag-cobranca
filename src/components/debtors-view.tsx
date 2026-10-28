"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageCircleIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RegisterPaymentDialog } from "@/components/register-payment-dialog";
import { SettleContractDialog } from "@/components/settle-contract-dialog";
import type { Debtor, DebtorInstallmentRow, PaidTodayRow } from "@/lib/debtors";
import { roundCents } from "@/lib/financial-rules";
import { CONTRACT_TYPE_LABELS, PAYMENT_METHOD_LABELS, type WhatsAppOpenMode } from "@/lib/types";
import { formatCurrency, formatDate, formatDateTime, formatPercent, formatPhone, onlyDigits } from "@/lib/utils";
import { buildWhatsAppChatUrl, openWhatsAppUrl } from "@/lib/whatsapp-open";
import { buildConsolidatedWhatsAppReminderLink } from "@/lib/whatsapp-reminder-link";
import { markReminderOpened } from "@/app/actions";

type FilterTab = "todos" | "hoje" | "atrasados" | "pagos";
type SortKey = "prioridade" | "nome" | "valor" | "vencimento" | "atraso";

const TABS: { value: FilterTab; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "hoje", label: "Vencem hoje" },
  { value: "atrasados", label: "Atrasados" },
  { value: "pagos", label: "Pagos hoje" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "prioridade", label: "Prioridade (padrão)" },
  { value: "nome", label: "Nome" },
  { value: "valor", label: "Maior valor" },
  { value: "vencimento", label: "Vencimento mais antigo" },
  { value: "atraso", label: "Mais dias de atraso" },
];

/**
 * Um mesmo devedor pode ter mais de uma dívida em aberto ao mesmo tempo
 * (ex.: um empréstimo e uma venda) — `debtor.rows` vem uma linha por
 * parcela, então agrupa por contrato antes de desenhar o botão "Quitar
 * dívida" (uma dívida = um contrato = um botão, nunca um por parcela).
 */
function groupRowsByContract(rows: DebtorInstallmentRow[]): { contract: DebtorInstallmentRow["contract"]; rows: DebtorInstallmentRow[] }[] {
  const groups = new Map<string, { contract: DebtorInstallmentRow["contract"]; rows: DebtorInstallmentRow[] }>();
  for (const row of rows) {
    const existing = groups.get(row.contract.id);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(row.contract.id, { contract: row.contract, rows: [row] });
    }
  }
  return Array.from(groups.values());
}

function DebtorBadge({ hasOverdue, hasDueToday }: { hasOverdue: boolean; hasDueToday: boolean }) {
  if (hasOverdue && hasDueToday) return <Badge variant="warning">🟠 Atrasado + vence hoje</Badge>;
  if (hasOverdue) return <Badge variant="destructive">🔴 Atrasado</Badge>;
  return <Badge variant="warning">🟡 Vence hoje</Badge>;
}

export function DebtorsView({
  debtors,
  paidToday,
  whatsappOpenMode = "padrao",
}: {
  debtors: Debtor[];
  paidToday: PaidTodayRow[];
  whatsappOpenMode?: WhatsAppOpenMode;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("todos");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("prioridade");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = debtors.filter((debtor) => {
      if (tab === "hoje" && !debtor.hasDueToday) return false;
      if (tab === "atrasados" && !debtor.hasOverdue) return false;
      if (!q) return true;
      return debtor.client.name.toLowerCase().includes(q);
    });

    list = [...list];
    if (sort === "nome") {
      list.sort((a, b) => a.client.name.localeCompare(b.client.name));
    } else if (sort === "valor") {
      list.sort((a, b) => b.totalDue - a.totalDue);
    } else if (sort === "vencimento") {
      list.sort((a, b) => {
        const aDue = Math.min(...a.rows.map((r) => new Date(r.installment.due_date).getTime()));
        const bDue = Math.min(...b.rows.map((r) => new Date(r.installment.due_date).getTime()));
        return aDue - bDue;
      });
    } else if (sort === "atraso") {
      list.sort((a, b) => b.maxDaysLate - a.maxDaysLate);
    }
    // "prioridade" mantém a ordenação já vinda do servidor (atrasados > vencem hoje > maior valor).

    return list;
  }, [debtors, tab, query, sort]);

  // Monta e abre o link consolidado (todas as parcelas em aberto deste
  // devedor numa única mensagem) de forma síncrona, na mesma interação de
  // clique — qualquer `await` antes do `window.open` faz o navegador
  // tratar a nova aba como pop-up e bloqueá-la (mesmo padrão já usado no
  // lembrete de parcela única em installments-grid.tsx).
  function handleCollectWhatsApp(debtor: Debtor) {
    const result = buildConsolidatedWhatsAppReminderLink(debtor, whatsappOpenMode);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    openWhatsAppUrl(result.url);
    toast.success("WhatsApp aberto com a cobrança consolidada. Confira e envie por lá.");

    // Best-effort: só registra que o lembrete foi iniciado para cada
    // parcela incluída (não comprova envio nem entrega) — nunca bloqueia
    // nem desfaz a abertura do WhatsApp já feita acima.
    for (const row of debtor.rows) {
      void markReminderOpened(row.installment.id);
    }
  }

  if (tab === "pagos") {
    return (
      <div className="flex flex-col gap-4">
        <FilterBar tab={tab} setTab={setTab} query={query} setQuery={setQuery} sort={sort} setSort={setSort} hideSort />
        <SpotlightCard className="overflow-hidden">
          {paidToday.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nenhum pagamento registrado hoje ainda.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {paidToday.map((row, index) => (
                <div key={index} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-medium text-foreground">{row.clientName}</span>
                    {row.installmentNumber !== null && (
                      <span className="text-muted-foreground">
                        {" "}
                        · Parcela {row.installmentNumber}/{row.totalInstallments}
                      </span>
                    )}
                    <span className="text-muted-foreground"> · {PAYMENT_METHOD_LABELS[row.method as keyof typeof PAYMENT_METHOD_LABELS]}</span>
                    {row.createdByEmail && (
                      <p className="text-xs text-muted-foreground">Registrado por {row.createdByEmail}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-success">{formatCurrency(row.amount)}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(row.paidAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SpotlightCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FilterBar tab={tab} setTab={setTab} query={query} setQuery={setQuery} sort={sort} setSort={setSort} />

      {filtered.length === 0 ? (
        <SpotlightCard>
          <p className="p-10 text-center text-sm text-muted-foreground">Nenhum devedor encontrado. 🎉</p>
        </SpotlightCard>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((debtor) => {
            const whatsappLink = buildWhatsAppChatUrl(onlyDigits(debtor.client.phone), undefined, whatsappOpenMode);
            const opensInSameTab = whatsappLink.startsWith("intent:");
            return (
              <SpotlightCard key={debtor.client.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link href={`/contracts/${debtor.rows[0].contract.id}`} className="font-semibold hover:underline">
                        👤 {debtor.client.name}
                      </Link>
                      <DebtorBadge hasOverdue={debtor.hasOverdue} hasDueToday={debtor.hasDueToday} />
                    </div>
                    <a
                      href={whatsappLink}
                      target={opensInSameTab ? undefined : "_blank"}
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <MessageCircleIcon className="size-3.5" />
                      {formatPhone(debtor.client.phone)}
                    </a>
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {debtor.rows.length > 1 ? "Total para regularizar" : "Total a pagar hoje"}
                      </p>
                      <p className="text-lg font-bold text-foreground">{formatCurrency(debtor.totalDue)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="glow"
                      size="sm"
                      onClick={() => handleCollectWhatsApp(debtor)}
                    >
                      <MessageCircleIcon />
                      Cobrar pelo WhatsApp
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-4">
                  {groupRowsByContract(debtor.rows).map((group) => (
                    <div key={group.contract.id} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {CONTRACT_TYPE_LABELS[group.contract.type]}
                          {group.contract.description ? ` — ${group.contract.description}` : ""}
                        </span>
                        <SettleContractDialog contractId={group.contract.id} triggerLabel="Quitar dívida" />
                      </div>
                      {group.rows.map((row) => {
                        // Cada campo abaixo representa um conceito distinto — nunca
                        // um já contém o outro embutido: valor original nunca
                        // muda, pago é o que o cliente já entregou de fato (principal
                        // + juros já quitados), saldo é só o principal que falta,
                        // juros é só o que ainda está em aberto agora, e o total
                        // devido (mostrado à direita) é sempre saldo + juros — nunca
                        // soma o total com o juros de novo.
                        const totalPaid = roundCents(
                          row.installment.paid_principal_amount + row.installment.paid_interest_amount,
                        );
                        return (
                          <div
                            key={row.installment.id}
                            className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                {row.isOverdue ? (
                                  <Badge variant="destructive">🔴 Atrasada</Badge>
                                ) : (
                                  <Badge variant="warning">🟡 Vence hoje</Badge>
                                )}
                                <span className="font-medium">
                                  Parcela {row.installment.number}/{row.contract.installments_count}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                Vencimento: {formatDate(row.installment.due_date)}
                                {row.isOverdue && ` · Atraso: ${row.daysLate} dia${row.daysLate > 1 ? "s" : ""}`}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Original: {formatCurrency(row.installment.amount)}
                                {totalPaid > 0 && ` · Pago: ${formatCurrency(totalPaid)}`} · Saldo:{" "}
                                {formatCurrency(row.outstandingPrincipal)}
                              </span>
                              {row.interestOwed > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  Juros de atraso ({formatPercent(row.contract.late_interest_rate_percent_per_day)}%/dia
                                  sobre o valor do contrato, {formatCurrency(row.contract.principal_amount)}):{" "}
                                  {formatCurrency(row.interestOwed)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total devido</p>
                                <span className="font-semibold">{formatCurrency(row.totalDue)}</span>
                              </div>
                              <RegisterPaymentDialog
                                installment={row.installment}
                                lateInterestRatePercentPerDay={row.contract.late_interest_rate_percent_per_day}
                                contractPrincipalAmount={row.contract.principal_amount}
                                triggerLabel="Marcar como pago"
                                clientName={debtor.client.name}
                                onPaid={() => router.refresh()}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </SpotlightCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterBar({
  tab,
  setTab,
  query,
  setQuery,
  sort,
  setSort,
  hideSort,
}: {
  tab: FilterTab;
  setTab: (tab: FilterTab) => void;
  query: string;
  setQuery: (query: string) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  hideSort?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
        <TabsList>
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <div className="relative sm:w-64">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!hideSort && (
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
