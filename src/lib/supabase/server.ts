import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * `@supabase/ssr` usa `httpOnly: false` por padrão (pensado para apps que
 * também acessam a sessão via `createBrowserClient` no navegador). Este
 * projeto nunca faz isso — todo acesso ao Supabase acontece em Server
 * Components/Actions, o cliente de navegador (`@/lib/supabase/client`)
 * não é usado em lugar nenhum — então não há motivo para o cookie de
 * sessão ser legível por JavaScript. `httpOnly: true` reduz o impacto de
 * um eventual XSS (o cookie não pode ser lido/exfiltrado via JS), e
 * `secure` garante que ele nunca trafegue fora de HTTPS em produção.
 */
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Chamado a partir de um Server Component sem middleware de sessão.
            // Pode ser ignorado se houver refresh de sessão em outro lugar.
          }
        },
      },
    },
  );
}

export function createServiceRoleClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
