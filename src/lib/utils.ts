import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/** Percentual no formato brasileiro, até 2 casas (ex.: 1,5). */
export function formatPercent(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function formatDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  // Com DDI 55 (12 ou 13 dígitos): exibe +55 antes do número nacional.
  const withCountry = digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
  if (withCountry) digits = digits.slice(2);
  const prefix = withCountry ? "+55 " : "";
  if (digits.length === 11) {
    return `${prefix}(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${prefix}(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return value;
}

/**
 * Máscara de telefone enquanto o usuário digita: (11) 91234-5678 para
 * celular, (11) 1234-5678 para fixo. Aceita no máximo 11 dígitos (DDD +
 * número); o que vai para o banco continua sendo só os dígitos.
 */
export function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/** Máscara de CEP enquanto o usuário digita: 00000-000. */
export function maskCep(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length <= 5 ? digits : `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Normaliza um telefone para o formato internacional exigido pelo link
 * `wa.me` (DDI + DDD + número, só dígitos, sem "+"): adiciona o 55 do
 * Brasil quando ausente, sem duplicar quando o número já vem com DDI.
 * Retorna null quando não há dígitos suficientes para um número válido —
 * nunca inventa ou completa dígitos faltantes.
 */
export function toWhatsAppDigits(phone: string): string | null {
  const digits = onlyDigits(phone);
  if (!digits) return null;

  // Já tem DDI 55 + DDD (2) + número (8 ou 9 dígitos) = 12 ou 13 dígitos.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  // DDD (2) + número (8 ou 9 dígitos), sem DDI = 10 ou 11 dígitos.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return null;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
