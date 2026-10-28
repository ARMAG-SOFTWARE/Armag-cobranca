import {
  AlertTriangleIcon,
  BanknoteIcon,
  CheckCircle2Icon,
  CoinsIcon,
  ReceiptIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import { DebtorsView } from "@/components/debtors-view";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { ShinyText } from "@/components/ui/shiny-text";
import { StatTile } from "@/components/ui/stat-tile";
import { getBusinessSettings } from "@/lib/business-settings";
import { getTodayDebtors } from "@/lib/debtors";
import { createClient } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function DebtorsPage() {
  const supabase = await createClient();
  const [{ debtors, summary, paidToday }, businessSettings] = await Promise.all([
    getTodayDebtors(supabase),
    getBusinessSettings(supabase),
  ]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <ShinyText className="text-xs font-semibold uppercase tracking-widest">Painel · {BRAND.name}</ShinyText>
        <GradientHeading className="text-3xl sm:text-4xl">📅 Devedores do Dia</GradientHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Clientes com parcela vencendo hoje ou já em atraso — a tela principal para a cobrança diária.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <StatTile label="Devedores" value={summary.debtorsCount} icon={AlertTriangleIcon} accent="warning" />
        <StatTile label="Parcelas" value={summary.installmentsCount} icon={ReceiptIcon} accent="primary" />
        <StatTile label="Valor previsto" value={summary.expectedAmount} format="currency" icon={WalletIcon} accent="cyan" />
        <StatTile
          label="Juros de atraso"
          value={summary.lateInterestAmount}
          format="currency"
          icon={CoinsIcon}
          accent="destructive"
        />
        <StatTile
          label="Total a receber"
          value={summary.totalToReceive}
          format="currency"
          icon={TrendingUpIcon}
          accent="warning"
        />
        <StatTile label="Pagos hoje" value={summary.paidTodayCount} icon={CheckCircle2Icon} accent="success" />
        <StatTile
          label="Recebido hoje"
          value={summary.receivedToday}
          format="currency"
          icon={BanknoteIcon}
          accent="success"
        />
      </div>

      <DebtorsView debtors={debtors} paidToday={paidToday} whatsappOpenMode={businessSettings.whatsappOpenMode} />
    </main>
  );
}
