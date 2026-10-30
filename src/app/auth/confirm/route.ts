import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Destino do link do e-mail de redefinição de senha. Aceita os dois
 * formatos do Supabase Auth:
 * - `token_hash` + `type` (template de e-mail recomendado; funciona mesmo
 *   abrindo o link em outro aparelho/navegador);
 * - `code` (padrão do Supabase; só funciona no mesmo navegador que pediu).
 * Cria a sessão e segue para `next` — sempre um caminho interno.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/redefinir-senha";
  // Nunca redireciona para fora do app (open redirect).
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/redefinir-senha";

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = request.nextUrl.clone();
  target.search = "";
  if (ok) {
    target.pathname = next;
  } else {
    target.pathname = "/esqueci-senha";
    target.searchParams.set("erro", "link");
  }
  return NextResponse.redirect(target);
}
