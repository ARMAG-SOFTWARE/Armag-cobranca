import type { ReactNode } from "react";

import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";

export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  // Só exibe o e-mail no menu — o acesso já foi validado pelo proxy nesta
  // mesma requisição. getClaims evita uma ida extra ao servidor de Auth.
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <AppNav userEmail={email} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
