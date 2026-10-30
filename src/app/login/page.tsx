import Link from "next/link";
import { LoginForm } from "@/components/login-form";
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

export default function LoginPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-7 px-4 py-10">
      <div className="flex flex-col items-center gap-3.5">
        <BrandMark />
        <div className="text-center">
          <div className="font-display text-2xl font-extrabold tracking-[0.3em]">{BRAND.name}</div>
          <div className="mt-2 text-[10.5px] tracking-[0.25em] text-muted-foreground uppercase">
            {BRAND.tagline}
          </div>
        </div>
      </div>

      <SpotlightCard className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Entrar</CardTitle>
          <CardDescription>Acesse com a conta cadastrada pelo administrador do sistema.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
          <Link
            href="/esqueci-senha"
            className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Esqueci minha senha
          </Link>
        </CardContent>
      </SpotlightCard>
    </main>
  );
}
