import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { filterAllowedClientIds, isContactBlocked } from "@/lib/whatsapp/consent";

// Mock mínimo e encadeável do query builder do Supabase. `terminal` define o
// que a última chamada aguardada resolve.
function fakeSupabase(terminal: { data: unknown }): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq"]) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve(terminal);
  builder.in = () => Promise.resolve(terminal);
  return builder as unknown as SupabaseClient;
}

describe("isContactBlocked", () => {
  it("true quando is_blocked é true", async () => {
    const s = fakeSupabase({ data: { is_blocked: true } });
    expect(await isContactBlocked(s, "owner", "cli")).toBe(true);
  });

  it("false quando is_blocked é false", async () => {
    const s = fakeSupabase({ data: { is_blocked: false } });
    expect(await isContactBlocked(s, "owner", "cli")).toBe(false);
  });

  it("false (default) quando não há registro de consentimento", async () => {
    const s = fakeSupabase({ data: null });
    expect(await isContactBlocked(s, "owner", "cli")).toBe(false);
  });
});

describe("filterAllowedClientIds", () => {
  it("remove os client_ids bloqueados e mantém o resto", async () => {
    const s = fakeSupabase({ data: [{ client_id: "b1" }, { client_id: "b2" }] });
    const allowed = await filterAllowedClientIds(s, "owner", ["a1", "b1", "a2", "b2"]);
    expect(allowed).toEqual(["a1", "a2"]);
  });

  it("lista vazia entra, lista vazia sai (sem consulta)", async () => {
    const s = fakeSupabase({ data: [] });
    expect(await filterAllowedClientIds(s, "owner", [])).toEqual([]);
  });

  it("nenhum bloqueado => devolve todos", async () => {
    const s = fakeSupabase({ data: [] });
    expect(await filterAllowedClientIds(s, "owner", ["a1", "a2"])).toEqual(["a1", "a2"]);
  });
});
