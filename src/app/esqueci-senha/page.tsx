import Link from "next/link";

import { PasswordResetRequestForm } from "@/components/password-reset-request-form";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

function BrandMark() {
  return (
    <svg width="60" height="60" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="brand-login-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={BRAND.glowColor} stopOpacity="1" />
          <stop offset="55%" stopColor={BRAND.primaryColor} stopOpacity="0.45" />
          <stop offset="100%" stopColor={BRAND.primaryColor} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#brand-login-glow)" />
      <circle cx="50" cy="50" r="28" fill="#0a0a0c" stroke={BRAND.glowColor} strokeWidth="2.5" />
      <ellipse cx="50" cy="50" rx="5.5" ry="18" fill={BRAND.glowColor} />
    </svg>
  );
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-7 px-4 py-10">
      <div className="flex flex-col items-center gap-3.5">
        <BrandMark />
        <div className="font-display text-2xl font-extrabold tracking-[0.3em]">{BRAND.name}</div>
      </div>

      <SpotlightCard className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Esqueci minha senha</CardTitle>
          <CardDescription>
            Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {erro === "link" && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              O link expirou ou já foi usado. Peça um novo abaixo.
            </p>
          )}
          <PasswordResetRequestForm />
          <Link href="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
            Voltar para o login
          </Link>
        </CardContent>
      </SpotlightCard>
    </main>
  );
}
