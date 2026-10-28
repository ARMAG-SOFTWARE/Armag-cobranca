import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadAllDocuments } from "./lib/documents.mjs";
import { decryptBuffer, encryptBuffer, loadEncryptionKey, sha256File } from "./lib/encryption.mjs";
import { run } from "./lib/exec.mjs";
import { copyToExtraTiers, applyRetentionPolicy, tiersForRun } from "./lib/retention.mjs";
import { sanitizeErrorMessage } from "./lib/sanitize.mjs";
import { createStorageClient, uploadObject, verifyUpload } from "./lib/storage.mjs";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

async function reportResult(appUrl, reportSecret, payload) {
  try {
    const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/backup/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${reportSecret}` },
      body: JSON.stringify(payload),
    });
    // fetch só lança exceção em falha de rede — uma resposta HTTP de erro
    // (401 secret errado, 500 etc.) precisa ser checada explicitamente,
    // senão o problema fica invisível no log do Actions.
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Falha ao reportar resultado do backup para a aplicação: HTTP ${response.status} — ${body}`);
    }
  } catch (error) {
    // Nunca deixa uma falha ao REPORTAR virar a causa de o job falhar por um
    // motivo diferente do real — só avisa no log do próprio Actions.
    console.error("Falha ao reportar resultado do backup para a aplicação:", error.message);
  }
}

async function main() {
  const startedAt = new Date();

  const databaseUrl = requireEnv("DATABASE_URL");
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const encryptionKeyBase64 = requireEnv("BACKUP_ENCRYPTION_KEY");
  const r2AccountId = requireEnv("R2_ACCOUNT_ID");
  const r2AccessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const r2SecretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const r2Bucket = requireEnv("R2_BUCKET_NAME");
  const appUrl = requireEnv("APP_URL");
  const reportSecret = requireEnv("BACKUP_REPORT_SECRET");

  const knownSecrets = [databaseUrl, serviceRoleKey, encryptionKeyBase64, r2SecretAccessKey, reportSecret];
  const encryptionKey = loadEncryptionKey(encryptionKeyBase64);

  const workDir = await mkdtemp(join(tmpdir(), "cobranca-backup-"));
  const validation = { dump_ok: false, documents_ok: false, package_ok: false, encryption_ok: false, upload_ok: false };

  try {
    // 1) Dump do Postgres — uma única transação (snapshot consistente,
    //    item 3), formato "custom" (comprimido, index para restauração
    //    seletiva). Schemas public (todas as tabelas da aplicação) + auth
    //    (usuário de login). --no-owner/--no-privileges evita erro de
    //    restauração num banco onde os papéis não são idênticos.
    const dumpPath = join(workDir, "database.dump");
    await run("pg_dump", [
      databaseUrl,
      "--format=custom",
      "--schema=public",
      "--schema=auth",
      "--no-owner",
      "--no-privileges",
      "--file",
      dumpPath,
    ]);

    // 2) Valida que o dump é estruturalmente íntegro usando a própria
    //    ferramenta do banco (item 7: "validado pelo mecanismo do banco"),
    //    não uma checagem caseira.
    const { stdout: dumpList } = await run("pg_restore", ["--list", dumpPath]);
    if (!dumpList.trim()) throw new Error("pg_dump gerou um arquivo sem nenhum objeto — dump considerado inválido.");
    validation.dump_ok = true;

    // 3) Documentos privados dos clientes (fora do Postgres — Supabase Storage).
    const documentsDir = join(workDir, "documents");
    await mkdir(documentsDir, { recursive: true });
    const { fileCount } = await downloadAllDocuments(supabaseUrl, serviceRoleKey, documentsDir);
    validation.documents_ok = true;

    // 4) Empacota dump + documentos num único arquivo.
    const archivePath = join(workDir, "backup.tar");
    await run("tar", ["-cf", archivePath, "-C", workDir, "database.dump", "documents"]);
    const archiveBuffer = await readFile(archivePath);
    const checksum = sha256File(archiveBuffer);
    validation.package_ok = true;

    // 5) Criptografa e confirma AGORA MESMO que a chave consegue abrir de
    //    volta o próprio arquivo que acabou de gerar (item 7) — nunca
    //    envia um arquivo para o armazenamento externo sem essa garantia.
    const encrypted = encryptBuffer(archiveBuffer, encryptionKey);
    const decryptedCheck = decryptBuffer(encrypted, encryptionKey);
    if (sha256File(decryptedCheck) !== checksum) {
      throw new Error("Verificação de criptografia falhou: o arquivo descriptografado não bate com o original.");
    }
    validation.encryption_ok = true;

    // 6) Upload para o armazenamento externo (R2) + camadas de retenção.
    const timestampLabel = startedAt.toISOString().replace(/[:.]/g, "-");
    const tiers = tiersForRun(startedAt);
    const objectKey = `6h/${timestampLabel}.enc`;
    const storageClient = createStorageClient({
      accountId: r2AccountId,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    });

    await uploadObject(storageClient, r2Bucket, objectKey, encrypted);
    await verifyUpload(storageClient, r2Bucket, objectKey, encrypted.length);
    await copyToExtraTiers(storageClient, r2Bucket, objectKey, tiers, timestampLabel);
    validation.upload_ok = true;

    // 7) Retenção só roda depois de confirmar que ESTE backup é válido —
    //    nunca apaga um backup antigo sem já ter um novo garantidamente bom.
    await applyRetentionPolicy(storageClient, r2Bucket, startedAt);

    const finishedAt = new Date();
    await reportResult(appUrl, reportSecret, {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status: "success",
      tiers,
      sizeBytes: encrypted.length,
      durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      destination: `r2:${r2Bucket}/${objectKey}`,
      checksum,
      validation,
    });

    console.log(
      `Backup concluído: ${objectKey} (${encrypted.length} bytes, ${fileCount} documento(s), camadas: ${tiers.join(", ")}).`,
    );
  } catch (error) {
    const finishedAt = new Date();
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error), knownSecrets);

    await reportResult(appUrl, reportSecret, {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status: "failed",
      tiers: [],
      durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      validation,
      errorMessage: message,
    });

    console.error("Backup FALHOU:", message);
    process.exitCode = 1;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main();
