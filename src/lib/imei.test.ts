import { describe, expect, it } from "vitest";

import { isValidImei, normalizeImei } from "@/lib/imei";

describe("isValidImei", () => {
  it("aceita exatamente 15 dígitos numéricos", () => {
    expect(isValidImei("123456789012345")).toBe(true);
  });

  it("preserva e exige zeros à esquerda — nunca trata o IMEI como número", () => {
    expect(isValidImei("012345678901234")).toBe(true);
    expect(isValidImei("12345678901234")).toBe(false); // 14 dígitos (perderia o zero à esquerda se virasse número)
  });

  it("rejeita menos de 15 dígitos", () => {
    expect(isValidImei("123456789012")).toBe(false);
  });

  it("rejeita mais de 15 dígitos", () => {
    expect(isValidImei("1234567890123456")).toBe(false);
  });

  it("rejeita caracteres não numéricos", () => {
    expect(isValidImei("12345678901234a")).toBe(false);
    expect(isValidImei("123-456-789-0123")).toBe(false);
  });

  it("ignora espaços acidentais no início/fim antes de validar", () => {
    expect(isValidImei("  123456789012345  ")).toBe(true);
  });

  it("string vazia é inválida (a obrigatoriedade/opcionalidade é decidida pelo schema, não aqui)", () => {
    expect(isValidImei("")).toBe(false);
  });
});

describe("normalizeImei", () => {
  it("remove só espaços no início/fim, nunca mexe no conteúdo interno", () => {
    expect(normalizeImei("  012345678901234  ")).toBe("012345678901234");
  });
});
