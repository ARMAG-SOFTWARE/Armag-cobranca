import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, DatabaseIcon } from "lucide-react";

import { BackupRunStatusBadge } from "@/components/status-badge";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { ShinyText } from "@/components/ui/shiny-text";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import type { BackupRun } from "@/lib/types";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

const EXPECTED_INTERVAL_HOURS = 6;
/** Margem de tolerância antes de considerar o backup "atrasado" (execuções raramente caem no minuto exato). */
const OVERDUE_TOLERANCE_HOURS = 2;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

function tierLabel(tiers: string[]): string {
  const labels: Record<string, string> = { "6h": "6h", daily: "Diário", monthly: "Mensal" };
  return tiers.map((t) => labels[t] ?? t).join(" + ") || "—";
}

/** Isolado do corpo do componente: só uma função de render nunca deve chamar `Date.now()`/`new Date()` diretamente. */
function hoursSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

export default async function BackupsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("backup_runs")
    .select("id, started_at, status, tiers, size_bytes, duration_seconds, validation, restore_tested")
    .order("started_at", { ascending: false })
    .limit(100);

  const runs = (data ?? []) as Pick<
    BackupRun,
    "id" | "started_at" | "status" | "tiers" | "size_bytes" | "duration_seconds" | "validation" | "restore_tested"
  >[];
  const lastSuccess = runs.find((r) => r.status === "success");
  const lastFailure = runs.find((r) => r.status === "failed");

  const hoursSinceLastSuccess = lastSuccess ? hoursSince(lastSuccess.started_at) : null;
  const isOverdue = hoursSinceLastSuccess === null || hoursSinceLastSuccess > EXPECTED_INTERVAL_HOURS + OVERDUE_TOLERANCE_HOURS;

  const totalRuns = runs.length;
  const successCount = runs.filter((r) => r.status === "success").length;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <ShinyText className="text-xs font-semibold uppercase tracking-widest">Painel · {BRAND.name}</ShinyText>
        <GradientHeading className="text-3xl sm:text-4xl">Backups</GradientHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Histórico das execuções do backup automático (a cada 6h, via GitHub Actions). Só metadados — nunca o
          conteúdo, a chave de criptografia ou as credenciais de armazenamento.
        </p>
      </div>

      {isOverdue && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="size-4 shrink-0" />
          {lastSuccess
            ? `Nenhum backup bem-sucedido nas últimas ${hoursSinceLastSuccess!.toFixed(1)}h (esperado a cada ${EXPECTED_INTERVAL_HOURS}h). Verifique o workflow no GitHub Actions.`
            : "Nenhum backup bem-sucedido encontrado ainda. Verifique se o workflow do GitHub Actions está configurado e rodando."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SpotlightCard className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Último backup válido
            </span>
            <CheckCircle2Icon className={`size-4 ${isOverdue ? "text-destructive" : "text-success"}`} />
          </div>
          <span className={`text-lg font-bold tracking-tight ${isOverdue ? "text-destructive" : "text-success"}`}>
            {lastSuccess ? formatDateTime(lastSuccess.started_at) : "Nenhum"}
          </span>
        </SpotlightCard>
        <StatTile label="Execuções (últimas 100)" value={totalRuns} icon={DatabaseIcon} accent="primary" />
        <StatTile label="Bem-sucedidas" value={successCount} icon={CheckCircle2Icon} accent="success" />
        <SpotlightCard className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Última falha</span>
            <ClockIcon className={`size-4 ${lastFailure ? "text-destructive" : "text-accent-cyan"}`} />
          </div>
          <span className={`text-lg font-bold tracking-tight ${lastFailure ? "text-destructive" : "text-accent-cyan"}`}>
            {lastFailure ? formatDateTime(lastFailure.started_at) : "Nenhuma"}
          </span>
        </SpotlightCard>
      </div>

      <SpotlightCard className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/hora</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Camada</TableHead>
              <TableHead>Tamanho</TableHead>
              <TableHead>Duração</TableHead>
              <TableHead>Validação</TableHead>
              <TableHead>Restauração testada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Nenhuma execução de backup registrada ainda.
                </TableCell>
              </TableRow>
            )}
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{formatDateTime(run.started_at)}</TableCell>
                <TableCell>
                  <BackupRunStatusBadge status={run.status} />
                </TableCell>
                <TableCell>{tierLabel(run.tiers)}</TableCell>
                <TableCell>{formatBytes(run.size_bytes)}</TableCell>
                <TableCell>{formatDuration(run.duration_seconds)}</TableCell>
                <TableCell>
                  {run.validation
                    ? Object.entries(run.validation)
                        .map(([key, ok]) => `${ok ? "✅" : "❌"} ${key}`)
                        .join(" · ")
                    : "—"}
                </TableCell>
                <TableCell>{run.restore_tested ? "Sim" : "Não"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SpotlightCard>
    </main>
  );
}
