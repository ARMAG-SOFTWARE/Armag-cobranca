import { describe, expect, it } from "vitest";

import { isAllowedProviderBaseUrl, isPrivateOrReservedIp, transactionSchema } from "@/lib/validations";

describe("isPrivateOrReservedIp", () => {
  it("marca IPs privados/reservados/loopback/link-local/ULA/CGNAT", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it("não marca IPs públicos", () => {
    for (const ip of ["203.0.113.10", "8.8.8.8", "172.15.0.1", "172.32.0.1", "2606:4700::1111", "::ffff:203.0.113.10"]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });
});

describe("isAllowedProviderBaseUrl", () => {
  it("aceita URLs públicas http(s)", () => {
    expect(isAllowedProviderBaseUrl("https://api.z-api.io")).toBe(true);
    expect(isAllowedProviderBaseUrl("https://evolution.minhaempresa.com.br:8080/")).toBe(true);
    expect(isAllowedProviderBaseUrl("http://203.0.113.10:8080")).toBe(true);
  });

  it("recusa endereços internos e protocolos não http", () => {
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://2130706433",
      "http://0x7f000001",
      "http://10.0.0.5",
      "http://172.16.0.1",
      "http://192.168.1.10",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://servidor.internal",
      "http://impressora.local",
      "http://user:senha@api.exemplo.com",
      "file:///etc/passwd",
      "ftp://exemplo.com",
      "não é url",
    ]) {
      expect(isAllowedProviderBaseUrl(url), url).toBe(false);
    }
  });
});

describe("transactionSchema — venda de produto (pods) em até 4 semanas", () => {
  const sale = {
    clientName: "Cliente Teste",
    clientPhone: "11999990000",
    type: "venda_iphone" as const,
    totalAmount: 100,
    firstDueDate: "2026-11-02",
    interestRatePercent: 20,
    hasDownPayment: false,
    downPaymentAmount: 0,
    downPaymentMethod: "dinheiro" as const,
    phoneModel: "Pod",
    phoneCostAmount: 50,
  };

  it.each([
    [24, "diaria"],
    [4, "semanal"],
    [2, "quinzenal"],
    [1, "mensal"],
  ] as const)("aceita %i parcela(s) %s", (installmentsCount, periodicity) => {
    expect(transactionSchema.safeParse({ ...sale, installmentsCount, periodicity }).success).toBe(true);
  });

  it.each([
    [25, "diaria"],
    [5, "semanal"],
    [3, "quinzenal"],
    [2, "mensal"],
  ] as const)("recusa %i parcela(s) %s", (installmentsCount, periodicity) => {
    const result = transactionSchema.safeParse({ ...sale, installmentsCount, periodicity });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["installmentsCount"]);
  });

  it("empréstimo não tem limite de 4 semanas", () => {
    const result = transactionSchema.safeParse({
      ...sale,
      type: "emprestimo",
      interestRatePercent: 7.5,
      installmentsCount: 12,
      periodicity: "mensal",
    });
    expect(result.success).toBe(true);
  });
});

describe("telefones com máscara", () => {
  const base = {
    clientName: "Cliente Teste",
    type: "emprestimo" as const,
    totalAmount: 100,
    installmentsCount: 4,
    periodicity: "semanal" as const,
    firstDueDate: "2026-11-02",
    interestRatePercent: 7.5,
    hasDownPayment: false,
    downPaymentAmount: 0,
    downPaymentMethod: "dinheiro" as const,
  };

  it.each(["(11) 91234-5678", "11912345678", "(11) 1234-5678"])("aceita %s", (clientPhone) => {
    expect(transactionSchema.safeParse({ ...base, clientPhone }).success).toBe(true);
  });

  it.each(["(11) 9123", "91234-5678", "(11) 91234-56789"])("recusa %s", (clientPhone) => {
    expect(transactionSchema.safeParse({ ...base, clientPhone }).success).toBe(false);
  });
});
