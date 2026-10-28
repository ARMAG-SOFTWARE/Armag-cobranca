import { copyObject, deleteObject, listObjects } from "./storage.mjs";

/**
 * Política de retenção (item 6): a mesma camada "6h" nunca é duplicada nas
 * camadas diária/mensal — o backup do horário 00:00 UTC é copiado (do lado
 * do servidor, sem reprocessar) também para "daily/"; o do dia 1º do mês
 * também para "monthly/".
 */
export const RETENTION_TIERS = {
  "6h": { prefix: "6h/", maxAgeDays: 7 },
  daily: { prefix: "daily/", maxAgeDays: 30 },
  monthly: { prefix: "monthly/", maxAgeDays: 365 },
};

/** Quais camadas este horário de execução alimenta, além da "6h" (sempre). */
export function tiersForRun(now = new Date()) {
  const tiers = ["6h"];
  if (now.getUTCHours() === 0) tiers.push("daily");
  if (now.getUTCHours() === 0 && now.getUTCDate() === 1) tiers.push("monthly");
  return tiers;
}

/**
 * Remove backups fora da janela de retenção de cada camada — mas NUNCA
 * remove o mais recente de uma camada, mesmo que ele já esteja "vencido"
 * (ex.: o processo ficou muito tempo sem rodar) — sempre sobra pelo menos
 * um backup válido em cada camada que já teve algum backup.
 */
export async function applyRetentionPolicy(client, bucket, now = new Date()) {
  const summary = {};
  for (const [tier, { prefix, maxAgeDays }] of Object.entries(RETENTION_TIERS)) {
    const objects = await listObjects(client, bucket, prefix);
    const sorted = [...objects].sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    const [, ...notMostRecent] = sorted;
    const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);
    const toDelete = notMostRecent.filter((o) => o.lastModified < cutoff);

    for (const obj of toDelete) {
      await deleteObject(client, bucket, obj.key);
    }

    summary[tier] = { total: objects.length, deleted: toDelete.length, kept: objects.length - toDelete.length };
  }
  return summary;
}

/** Copia (lado do servidor) o backup recém-enviado para as camadas extras deste horário. */
export async function copyToExtraTiers(client, bucket, sourceKey, tiers, timestampLabel) {
  const labelByTier = {
    daily: `daily/${timestampLabel.slice(0, 10)}.enc`,
    monthly: `monthly/${timestampLabel.slice(0, 7)}.enc`,
  };
  for (const tier of tiers) {
    if (tier === "6h") continue;
    const destKey = labelByTier[tier];
    if (destKey) await copyObject(client, bucket, sourceKey, destKey);
  }
}
