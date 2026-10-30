import { afterEach, describe, expect, it, vi } from "vitest";

// Mock do DNS: o nome precisa começar com "mock" para o hoisting do vi.mock.
const mockLookup = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => mockLookup(...args) }));

import { safeProviderFetch } from "@/lib/whatsapp/safe-fetch";

describe("safeProviderFetch (anti-SSRF)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockLookup.mockReset();
  });

  it("rejeita host interno literal antes de resolver ou buscar", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(safeProviderFetch("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    expect(mockLookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejeita quando o host público resolve para IP interno (DNS rebinding)", async () => {
    mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(safeProviderFetch("https://evil.exemplo.com/x")).rejects.toThrow(/interno|reservado/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejeita se QUALQUER IP resolvido for interno", async () => {
    mockLookup.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(safeProviderFetch("https://api.exemplo.com/x")).rejects.toThrow(/interno|reservado/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bloqueia redirecionamento 3xx (não segue para destino possivelmente interno)", async () => {
    mockLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 302 }));
    await expect(safeProviderFetch("https://api.exemplo.com/x")).rejects.toThrow(/redirecion/i);
  });

  it("deixa passar host público que resolve para IP público", async () => {
    mockLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await safeProviderFetch("https://api.exemplo.com/x");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
