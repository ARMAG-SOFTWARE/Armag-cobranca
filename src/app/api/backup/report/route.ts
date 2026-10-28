import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendBackupFailureAlert } from "@/lib/backup-alert";
import { isAuthorizedBySecret } from "@/lib/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Recebe o RESULTADO de uma execução do backup automático (scripts/backup/,
 * disparado pelo GitHub Actions a cada 6h) — nunca o conteúdo do backup em
 * si. Chamado só pelo workflow, autenticado por `BACKUP_REPORT_SECRET`
 * (segredo próprio, separado do `CRON_SECRET` usado pelos crons da Vercel —
 * cada chamador externo com sua própria credencial).
 */
const reportSchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  status: z.enum(["success", "failed"]),
  tiers: z.array(z.enum(["6h", "daily", "monthly"])).default([]),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  destination: z.string().optional(),
  checksum: z.string().optional(),
  validation: z.record(z.string(), z.boolean()).optional(),
  errorMessage: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedBySecret(request, "BACKUP_REPORT_SECRET")) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const data = parsed.data;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("backup_runs").insert({
    started_at: data.startedAt,
    finished_at: data.finishedAt,
    status: data.status,
    tiers: data.tiers,
    size_bytes: data.sizeBytes ?? null,
    duration_seconds: data.durationSeconds ?? null,
    destination: data.destination ?? null,
    checksum: data.checksum ?? null,
    validation: data.validation ?? null,
    error_message: data.errorMessage ?? null,
  });

  if (error) {
    return NextResponse.json({ error: "Erro ao registrar execução do backup." }, { status: 500 });
  }

  if (data.status === "failed") {
    const finishedAtLabel = new Date(data.finishedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await sendBackupFailureAlert(
      supabase,
      `Data/hora: ${finishedAtLabel}\nStatus: FALHOU\nMotivo: ${data.errorMessage ?? "não informado"}`,
    );
  }

  return NextResponse.json({ ok: true });
}
