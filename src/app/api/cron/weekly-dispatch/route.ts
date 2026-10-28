import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedBySecret } from "@/lib/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { runWeeklyDispatchQueue } from "@/lib/scheduling/weekly-dispatch-queue";

export const dynamic = "force-dynamic";

// Tempo máximo da function. Na Vercel isso é limitado pelo plano
// (Hobby: até 60s; Pro: até 300s por padrão, maior sob configuração).
// A fila respeita esse orçamento internamente e retoma o restante na
// próxima execução do cron — ajuste `maxDurationMs` abaixo junto com
// este valor caso seu plano permita mais tempo.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedBySecret(request, "CRON_SECRET")) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const summary = await runWeeklyDispatchQueue(supabase, { maxDurationMs: 280_000 });

  return NextResponse.json(summary);
}
