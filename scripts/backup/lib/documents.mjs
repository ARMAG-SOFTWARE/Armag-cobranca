import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createClient } from "@supabase/supabase-js";

const DOCUMENTS_BUCKET = "client-documents";

/**
 * Baixa todo o conteúdo do bucket privado de documentos dos clientes para
 * uma pasta local (parte do arquivo de backup). Usa a service role key —
 * a mesma já usada pelos crons desta aplicação, nunca uma nova credencial
 * exposta a mais lugares do que o necessário.
 */
export async function downloadAllDocuments(supabaseUrl, serviceRoleKey, destDir) {
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(prefix) {
    const { data: entries, error } = await supabase.storage.from(DOCUMENTS_BUCKET).list(prefix, { limit: 1000 });
    if (error) throw new Error(`Falha ao listar documentos (${prefix || "/"}): ${error.message}`);

    for (const entry of entries ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Uma "pasta" no Storage do Supabase é representada por uma entrada
      // sem `id`/metadata de arquivo — desce recursivamente nela.
      if (entry.id === null) {
        await walk(path);
        continue;
      }

      const { data: blob, error: downloadError } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
      if (downloadError) throw new Error(`Falha ao baixar documento ${path}: ${downloadError.message}`);

      const buffer = Buffer.from(await blob.arrayBuffer());
      const localPath = join(destDir, path);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, buffer);
      fileCount += 1;
      totalBytes += buffer.length;
    }
  }

  await walk("");
  return { fileCount, totalBytes };
}
