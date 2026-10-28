import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM (autenticado — qualquer adulteração/corrupção do arquivo é
 * detectada na descriptografia, nunca passa silenciosamente). Formato do
 * arquivo final: [12 bytes IV][16 bytes auth tag][ciphertext].
 *
 * A chave nunca é derivada de senha nem fica no arquivo — vem de
 * `BACKUP_ENCRYPTION_KEY` (variável de ambiente, só no runner do GitHub
 * Actions, nunca no repositório/código/log). Ver README de restauração
 * para como recuperá-la em caso de emergência: ela SÓ existe nos secrets
 * do GitHub e onde você a guardar por fora (ex.: gerenciador de senhas) —
 * perder essa chave significa perder a capacidade de abrir os backups.
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Lê a chave de 32 bytes a partir da variável de ambiente (base64). */
export function loadEncryptionKey(base64Key) {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY precisa decodificar para exatamente 32 bytes (AES-256); obtive ${key.length} bytes.`,
    );
  }
  return key;
}

export function generateEncryptionKeyBase64() {
  return randomBytes(32).toString("base64");
}

export function sha256File(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function encryptBuffer(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptBuffer(encrypted, key) {
  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // Lança se a tag de autenticação não bater (arquivo corrompido/adulterado
  // ou chave errada) — nunca devolve dado parcial/inválido silenciosamente.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
