import { describe, expect, it } from "vitest";

import { isAllowedProviderBaseUrl } from "@/lib/validations";

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
