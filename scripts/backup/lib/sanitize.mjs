/**
 * Remove qualquer segredo conhecido de uma mensagem de erro antes dela ir
 * para o relatório da aplicação/log do GitHub Actions — comandos de linha
 * de comando (pg_dump, aws-cli) às vezes ecoam a connection string ou uma
 * credencial na própria mensagem de erro.
 */
export function sanitizeErrorMessage(message, secrets) {
  let sanitized = String(message);
  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized.split(secret).join("***");
  }
  // Connection strings do Postgres têm o formato postgres://user:senha@host —
  // some por completo mesmo que a senha não esteja na lista de secrets acima.
  sanitized = sanitized.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://***");
  return sanitized.slice(0, 1500);
}
