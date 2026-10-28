/**
 * Identidade do sistema num único lugar — trocar nome ou cor da marca é
 * editar só este arquivo (mais `public/manifest.json`, os ícones em
 * `public/` e os tokens de cor em `app/globals.css`, que não podem importar
 * TypeScript).
 */
export const BRAND = {
  /** Nome provisório até o cliente definir o definitivo. */
  name: "ARMAG",
  fullName: "ARMAG — Gestão de Empréstimos e Vendas",
  tagline: "Cobrança sob controle",
  /** Verde da marca (mesmo valor de --primary em globals.css). */
  primaryColor: "#14b866",
  /** Verde mais claro, para brilho/contorno do logotipo. */
  glowColor: "#2fe08a",
  /** Fundo do logotipo e da barra do navegador. */
  backgroundColor: "#080809",
} as const;
