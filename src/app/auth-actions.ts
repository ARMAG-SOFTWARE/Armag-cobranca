"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { logAudit } from "@/lib/audit-log";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  loginSchema,
  newPasswordSchema,
  passwordResetRequestSchema,
  type LoginInput,
  type NewPasswordInput,
  type PasswordResetRequestInput,
} from "@/lib/validations";
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

/** Origem pública do app (ex.: https://armag.vercel.app), a partir da própria requisição. */
async function appOrigin(): Promise<string> {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * "Esqueci minha senha": envia o e-mail de redefinição do Supabase Auth.
 * A resposta é SEMPRE a mesma, exista o e-mail ou não — nunca revela quais
 * contas existem. Limitado pelo mesmo controle de tentativas do login.
 */
export async function requestPasswordReset(input: PasswordResetRequestInput): Promise<ActionResult> {
  const parsed = passwordResetRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const ip = await clientIp();
  const { allowed, retryAfterSeconds } = checkRateLimit(`reset:${ip}:${email}`);
  if (!allowed) {
    return {
      ok: false,
      error: `Muitas tentativas. Tente novamente em ${Math.ceil(retryAfterSeconds / 60)} minuto(s).`,
    };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await appOrigin()}/auth/confirm?next=/redefinir-senha`,
  });
  await logAudit(createServiceRoleClient(), { actorEmail: email, ownerId: null, action: "password_reset_requested" });
  return { ok: true };
}

/** Grava a nova senha do usuário que chegou pelo link de redefinição (já com sessão). */
export async function updatePassword(input: NewPasswordInput): Promise<ActionResult> {
  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error || !data.user) {
    return { ok: false, error: "Não foi possível alterar a senha. Peça um novo link de redefinição." };
  }

  await logAudit(supabase, { actorEmail: data.user.email ?? null, ownerId: data.user.id, action: "password_changed" });
  return { ok: true };
}
