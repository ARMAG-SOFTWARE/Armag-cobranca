import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Atualiza a sessão do Supabase a cada requisição (Server Components não
 * conseguem escrever cookies, só o proxy.ts pode) e redireciona para
 * /login quem não estiver autenticado. Rotas de API (/api/**, incluindo os
 * crons) ficam fora do matcher deste proxy — elas usam CRON_SECRET, não
 * sessão de usuário.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Mesmo hardening de src/lib/supabase/server.ts: o cookie de sessão
      // nunca precisa ser lido por JavaScript no navegador neste app.
      cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // `getClaims()` em vez de `getUser()`: continua renovando a sessão
  // expirada (via getSession, que grava os cookies pelo setAll acima), mas
  // valida o JWT localmente com a chave pública do projeto quando ele usa
  // chaves assimétricas — sem uma ida ao servidor de Auth do Supabase a
  // cada navegação. Com chave simétrica (legada), cai sozinho para
  // `getUser()`, ou seja, nunca fica menos seguro que antes. O RLS do
  // Postgres revalida o JWT em toda consulta de qualquer forma.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  const pathname = request.nextUrl.pathname;
  const isLoginRoute = pathname.startsWith("/login");
  if (!user && !isLoginRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLoginRoute) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}
