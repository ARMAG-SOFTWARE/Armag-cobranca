import { BoxIcon, HandCoinsIcon, ReceiptIcon, TrendingUpIcon, WalletIcon } from "lucide-react";

import { IphoneSalesTable } from "@/components/iphone-sales-table";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { ShinyText } from "@/components/ui/shiny-text";
import { StatTile } from "@/components/ui/stat-tile";
import { getIphoneSales } from "@/lib/iphone-sales";
import { createClient } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function PhonesPage() {
  const supabase = await createClient();
  const { sales, summary } = await getIphoneSales(supabase);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <ShinyText className="text-xs font-semibold uppercase tracking-widest">Painel · {BRAND.name}</ShinyText>
        <GradientHeading className="text-3xl sm:text-4xl">Vendas de Produtos</GradientHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada venda é uma operação individual — custo, valor de venda e lucro rastreados separadamente dos
          empréstimos. Para cadastrar uma nova venda, use o botão &ldquo;Novo Cadastro&rdquo; na tela de Clientes.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Vendas" value={summary.count} icon={BoxIcon} accent="primary" />
        <StatTile label="Total investido" value={summary.totalCost} format="currency" icon={WalletIcon} accent="cyan" />
        <StatTile
          label="Total em vendas"
          value={summary.totalSaleValue}
          format="currency"
          icon={HandCoinsIcon}
          accent="warning"
        />
        <StatTile
          label="Lucro real"
          value={summary.totalProfit}
          format="currency"
          icon={TrendingUpIcon}
          accent="success"
        />
        <StatTile
          label="Total recebido"
          value={summary.totalReceived}
          format="currency"
          icon={WalletIcon}
          accent="cyan"
        />
        <StatTile
          label="Total pendente"
          value={summary.totalPending}
          format="currency"
          icon={ReceiptIcon}
          accent="destructive"
        />
      </div>

      <IphoneSalesTable sales={sales} />
    </main>
  );
}
