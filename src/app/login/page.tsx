import { LoginForm } from "@/components/login-form";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SpotlightCard } from "@/components/ui/spotlight-card";

export const dynamic = "force-dynamic";

function BrandMark() {
  return (
    <svg width="60" height="60" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="recebe-login-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff3548" stopOpacity="1" />
          <stop offset="55%" stopColor="#e5233d" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#e5233d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#recebe-login-glow)" />
      <circle cx="50" cy="50" r="28" fill="#0a0a0c" stroke="#ff3548" strokeWidth="2.5" />
      <ellipse cx="50" cy="50" rx="5.5" ry="18" fill="#ff3548" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-7 px-4 py-10">
      <div className="flex flex-col items-center gap-3.5">
        <BrandMark />
        <div className="text-center">
          <div className="font-display text-2xl font-extrabold tracking-[0.3em]">RECEBE</div>
          <div className="mt-2 text-[10.5px] tracking-[0.25em] text-muted-foreground uppercase">
            Cobrança sob controle
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
        </CardContent>
      </SpotlightCard>
    </main>
  );
}
