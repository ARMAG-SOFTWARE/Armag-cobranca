/**
 * Limitador de taxa em memória — proteção de melhor esforço contra força
 * bruta/credential stuffing no login (item 5/21 da auditoria). É por
 * instância do processo: em ambientes serverless com múltiplas instâncias
 * concorrentes, cada uma tem seu próprio contador, então isto COMPLEMENTA
 * mas não substitui o rate limiting que o próprio servidor de autenticação
 * do Supabase já aplica (ver relatório final para onde ajustar isso no
 * painel do Supabase). Ainda assim é uma barreira real contra um script
 * simples tentando muitas senhas em sequência contra a mesma instância.
 *
 * Limite generoso o bastante para nunca atrapalhar o único usuário
 * legítimo do sistema (10 tentativas a cada 5 minutos por combinação de
 * IP + e-mail) — um usuário real errando a senha algumas vezes nunca é
 * bloqueado; um script tentando dezenas de senhas em sequência, sim.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Chamado após um login bem-sucedido, para não penalizar tentativas futuras legítimas. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
