import { describe, expect, it } from "vitest";

import { timingSafeEqualStr } from "@/lib/constant-time";

describe("timingSafeEqualStr", () => {
  it("retorna true para strings iguais", () => {
    expect(timingSafeEqualStr("segredo-123", "segredo-123")).toBe(true);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });

  it("retorna false para conteúdo diferente de mesmo tamanho", () => {
    expect(timingSafeEqualStr("segredo-123", "segredo-124")).toBe(false);
  });

  it("retorna false para comprimentos diferentes", () => {
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("token", "")).toBe(false);
  });
});
