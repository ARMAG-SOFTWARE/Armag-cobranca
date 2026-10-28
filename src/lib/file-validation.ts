/**
 * Verifica o CONTEÚDO real de um arquivo (assinatura/"magic bytes"), nunca
 * confiando apenas na extensão do nome ou no `Content-Type` que o navegador
 * declarou (ambos são fornecidos pelo cliente e podem ser forjados). Usado
 * para o upload de documento do cliente — só aceita os formatos abaixo,
 * deliberadamente SEM SVG (pode conter `<script>` embutido — um vetor de
 * XSS armazenado clássico) e sem tipos executáveis/HTML.
 *
 * A extensão do arquivo salvo vem sempre do tipo DETECTADO aqui, nunca do
 * nome que o usuário enviou — remove qualquer possibilidade de "smuggling"
 * de extensão (ex.: enviar `foto.jpg` que na verdade é um `.html`).
 */
export interface DetectedFileType {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  extension: "jpg" | "png" | "webp" | "pdf";
}

function bytesStartWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export async function detectSafeDocumentType(file: File): Promise<DetectedFileType | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  if (bytesStartWith(head, [0xff, 0xd8, 0xff])) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytesStartWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytesStartWith(head, [0x52, 0x49, 0x46, 0x46]) && bytesStartWith(head, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (bytesStartWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { mimeType: "application/pdf", extension: "pdf" };
  }

  return null;
}
