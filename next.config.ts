import type { NextConfig } from "next";

/**
 * Headers de segurança (auditoria — item 16). Só em produção: o modo de
 * desenvolvimento do Next (Turbopack/HMR) usa eval e recursos que uma CSP
 * estrita quebraria, e HSTS não faz sentido em localhost/HTTP. Nada disso
 * afeta o comportamento em `next dev`.
 *
 * O app nunca carrega script/estilo/imagem de origem externa (sem CDN, sem
 * `next/image` com domínio remoto, sem `<img>` — documentos do cliente são
 * abertos via link, não incorporados) e nunca é embutido em iframe de outro
 * site — por isso a política abaixo pode ser relativamente restrita sem
 * quebrar nada. `'unsafe-inline'` em script/style continua necessário
 * porque o Next injeta scripts de hidratação e a página usa `style` inline
 * em alguns componentes; isso não abre a porta para carregar script de um
 * domínio externo (que é o risco principal que XSS explora), só permite o
 * que já está no HTML servido por nós.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Redundante com `frame-ancestors 'none'` da CSP, mas mantido para
  // navegadores antigos que ainda não suportam esse diretivo da CSP.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
