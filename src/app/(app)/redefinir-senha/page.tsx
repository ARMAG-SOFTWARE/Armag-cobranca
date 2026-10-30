import { NewPasswordForm } from "@/components/new-password-form";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GradientHeading } from "@/components/ui/gradient-heading";
import { SpotlightCard } from "@/components/ui/spotlight-card";

export const dynamic = "force-dynamic";

/** Aberta pelo link do e-mail de redefinição (já com sessão) ou por quem quiser trocar a senha. */
export default function RedefinirSenhaPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <GradientHeading className="text-2xl sm:text-3xl">Nova senha</GradientHeading>
      <SpotlightCard className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Criar nova senha</CardTitle>
          <CardDescription>Use pelo menos 8 caracteres.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewPasswordForm />
        </CardContent>
      </SpotlightCard>
    </main>
  );
}
