import { describe, expect, it } from "vitest";

import { formatPhone, maskCep, maskPhone } from "@/lib/utils";

describe("maskPhone (enquanto digita)", () => {
  it.each([
    ["", ""],
    ["1", "(1"],
    ["11", "(11"],
    ["119", "(11) 9"],
    ["1191234", "(11) 9123-4"],
    ["1112345678", "(11) 1234-5678"],
    ["11912345678", "(11) 91234-5678"],
    ["119123456789999", "(11) 91234-5678"],
    ["(11) 91234-5678", "(11) 91234-5678"],
  ])("%s → %s", (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });
});

describe("maskCep", () => {
  it.each([
    ["", ""],
    ["01310", "01310"],
    ["013101", "01310-1"],
    ["01310100", "01310-100"],
    ["013101009", "01310-100"],
  ])("%s → %s", (input, expected) => {
    expect(maskCep(input)).toBe(expected);
  });
});

describe("formatPhone (exibição)", () => {
  it("formata celular, fixo e número com DDI 55", () => {
    expect(formatPhone("11912345678")).toBe("(11) 91234-5678");
    expect(formatPhone("1112345678")).toBe("(11) 1234-5678");
    expect(formatPhone("5511912345678")).toBe("+55 (11) 91234-5678");
  });
});
