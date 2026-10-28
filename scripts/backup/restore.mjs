#!/usr/bin/env node
// Restauração de um backup — SEMPRE manual, nunca chamado pelo workflow
// automático. Exige que você digite a confirmação e informe explicitamente
// o banco de destino (nunca assume produção por padrão).
//
// Uso:
//   node restore.mjs --key 6h/2026-09-20T10-00-00Z.enc --target-db "postgres://...:5432/postgres" [--documents-dir ./restored-documents] [--yes]
//
// Variáveis de ambiente necessárias (as mesmas do backup):
//   BACKUP_ENCRYPTION_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
//
// Documentos (Storage) são extraídos para --documents-dir para você revisar/
// reenviar manualmente ao bucket de destino — este script não sobrescreve
// um bucket de Storage sozinho.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { decryptBuffer, loadEncryptionKey, sha256File } from "./lib/encryption.mjs";
import { run } from "./lib/exec.mjs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createStorageClient } from "./lib/storage.mjs";

function parseArgs(argv) {
  const args = { yes: false, documentsDir: "./restored-documents" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key") args.key = argv[++i];
    else if (argv[i] === "--target-db") args.targetDb = argv[++i];
    else if (argv[i] === "--documents-dir") args.documentsDir = argv[++i];
    else if (argv[i] === "--expected-checksum") args.expectedChecksum = argv[++i];
    else if (argv[i] === "--yes") args.yes = true;
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function confirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${message}\nDigite exatamente RESTAURAR para confirmar: `);
  rl.close();
  return answer.trim() === "RESTAURAR";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.key) throw new Error("Informe --key <caminho do backup no R2>, ex.: 6h/2026-09-20T10-00-00Z.enc");
  if (!args.targetDb) {
    throw new Error(
      "Informe --target-db com a connection string do banco de DESTINO (nunca assumido — não existe padrão de produção aqui).",
    );
  }

  const encryptionKey = loadEncryptionKey(requireEnv("BACKUP_ENCRYPTION_KEY"));
  const r2Bucket = requireEnv("R2_BUCKET_NAME");
  const storageClient = createStorageClient({
    accountId: requireEnv("R2_ACCOUNT_ID"),
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
  });

  console.log(`Baixando ${args.key} de r2:${r2Bucket}...`);
  const object = await storageClient.send(new GetObjectCommand({ Bucket: r2Bucket, Key: args.key }));
  const encrypted = await streamToBuffer(object.Body);

  console.log("Descriptografando...");
  const archiveBuffer = decryptBuffer(encrypted, encryptionKey);
  const checksum = sha256File(archiveBuffer);
  console.log(`Checksum SHA-256 do conteúdo restaurado: ${checksum}`);
  if (args.expectedChecksum && args.expectedChecksum !== checksum) {
    throw new Error(
      `Checksum não confere (esperado ${args.expectedChecksum}, obtido ${checksum}) — arquivo corrompido ou incorreto. Restauração ABORTADA.`,
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "cobranca-restore-"));
  try {
    const archivePath = join(workDir, "backup.tar");
    await writeFile(archivePath, archiveBuffer);
    await run("tar", ["-xf", archivePath, "-C", workDir]);

    await mkdir(args.documentsDir, { recursive: true });
    await run("cp", ["-r", join(workDir, "documents") + "/.", args.documentsDir]).catch(() => {
      // Pasta "documents" pode não existir se o backup não tinha nenhum arquivo — não é erro.
    });
    console.log(`Documentos extraídos para ${args.documentsDir} (reenvie manualmente ao Storage do projeto de destino).`);

    console.log(
      `\n⚠️  Prestes a restaurar o banco em: ${args.targetDb.replace(/:\/\/[^@]+@/, "://***@")}\n` +
        "Isso executa pg_restore --clean, que APAGA e recria os objetos existentes nesse banco de destino.\n" +
        "NUNCA aponte isso para o banco de produção sem ter certeza absoluta.",
    );
    if (!args.yes && !(await confirm("Confirma a restauração?"))) {
      console.log("Restauração cancelada pelo usuário.");
      return;
    }

    const dumpPath = join(workDir, "database.dump");
    await run("pg_restore", [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "-d",
      args.targetDb,
      dumpPath,
    ]);

    console.log(
      "\nRestauração do banco concluída. Agora confira manualmente (ver checklist no README de backup):\n" +
        "- quantidade de clientes/empréstimos/parcelas/pagamentos\n" +
        "- valores de fluxo de caixa\n" +
        "- vendas de iPhone e histórico\n" +
        "- relacionamentos (cliente -> contrato -> parcela -> pagamento)\n" +
        "- reenvie os documentos extraídos para o Storage do projeto de destino.",
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Restauração FALHOU:", error.message);
  process.exitCode = 1;
});
