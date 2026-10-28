import { NextRequest } from "next/server";

/**
 * Autoriza uma rota chamada por um processo externo (cron, GitHub Actions),
 * nunca por um usuário logado — comparação por `Bearer <secret>`. Nega por
 * padrão quando o segredo não está configurado (fail-closed): antes, uma
 * rota assim ficava aberta para qualquer um quando alguém esquecia de
 * configurar a variável de ambiente — um endpoint público com acesso de
 * service role (ignora RLS). Cada chamador externo usa seu PRÓPRIO segredo
 * (nunca o mesmo em dois lugares), então vazar um não compromete o outro.
 */
export function isAuthorizedBySecret(request: NextRequest, secretEnvVar: string): boolean {
  const secret = process.env[secretEnvVar];
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
