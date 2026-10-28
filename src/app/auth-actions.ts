"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { logAudit } from "@/lib/audit-log";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loginSchema, type LoginInput } from "@/lib/validations";
import type { ActionResult } from "@/app/actions";

async function clientIp(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "unknown";
}

export async function signIn(input: LoginInput): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const ip = await clientIp();
  const rateLimitKey = `login:${ip}:${email}`;

  const { allowed, retryAfterSeconds } = checkRateLimit(rateLimitKey);
  if (!allowed) {
    return {
      ok: false,
      error: `Muitas tentativas. Tente novamente em ${Math.ceil(retryAfterSeconds / 60)} minuto(s).`,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Resposta sempre genérica (item 4): nunca revela se o e-mail existe
    // ou não, nem se o problema foi usuário inexistente ou senha errada —
    // isso protege contra enumeração de contas.
    //
    // Usa a service role aqui (não o `supabase` normal): antes de um login
    // bem-sucedido não existe sessão nenhuma, então o cliente comum está
    // como "anon" e a RLS de `audit_logs` (só autenticado) descartaria a
    // gravação silenciosamente — exatamente o evento que mais importa
    // registrar continuaria sem nenhum rastro.
    await logAudit(createServiceRoleClient(), { actorEmail: email, ownerId: null, action: "login_failed" });
    return { ok: false, error: "Credenciais inválidas." };
  }

  resetRateLimit(rateLimitKey);
  await logAudit(supabase, { actorEmail: email, ownerId: data.user?.id ?? null, action: "login_success" });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await logAudit(supabase, { actorEmail: user?.email ?? null, ownerId: user?.id ?? null, action: "logout" });
  await supabase.auth.signOut();
  redirect("/login");
}
