import { spawn } from "node:child_process";

/**
 * Executa um comando externo (pg_dump, pg_restore, tar) capturando
 * stdout/stderr. Nunca deixa a saída bruta do processo vazar para o
 * relatório final sem passar por `sanitizeErrorMessage` — comandos de
 * banco frequentemente ecoam a connection string usada em mensagens de
 * erro.
 */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`"${command} ${args.join(" ")}" saiu com código ${code}. stderr: ${stderr.trim()}`));
    });
  });
}
