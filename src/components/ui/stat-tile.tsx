import type { LucideIcon } from "lucide-react";

import { SpotlightCard } from "@/components/ui/spotlight-card";
import { cn, formatCurrency } from "@/lib/utils";

type StatAccent = "primary" | "cyan" | "success" | "destructive" | "warning";

const ACCENT_TEXT: Record<StatAccent, string> = {
  primary: "text-primary",
  cyan: "text-foreground",
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
};

/** Card de estatística (bento) — o valor aparece direto, sem animação de contagem. */
export function StatTile({
  label,
  value,
  icon: Icon,
  format,
  accent = "primary",
  className,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  format?: "currency";
  accent?: StatAccent;
  className?: string;
}) {
  return (
    <SpotlightCard className={cn("flex flex-col gap-3 p-4 sm:p-5", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={cn("size-4", ACCENT_TEXT[accent])} />
      </div>
      <span className={cn("text-2xl font-bold tracking-tight tabular-nums sm:text-3xl", ACCENT_TEXT[accent])}>
        {format === "currency" ? formatCurrency(value) : value.toLocaleString("pt-BR")}
      </span>
    </SpotlightCard>
  );
}
