import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B1646 — the operator's Providers section. Properties: a figure only where a
 * provider's own API returned one, every state drawn, the four-hour cache and
 * its bypass, thresholds from config, attention entries, admin-only route and
 * no key in anything returned. No provider is called: fetch is stubbed.
 */

const state = vi.hoisted(() => ({
  admin: true,
  lowBelow: {} as Record<string, { lowBelow: number }>,
  features: {
    sms: { enabled: false },
    transcription: { enabled: false },
    postcards: { enabled: false },
  } as Record<string, { enabled: boolean; backend?: string }>,
  stannp: { keySet: true, result: { value: 14.6, currency: "GBP" } as { value: number; currency: string | null } | Error },
  orders: [] as unknown[],
}));

vi.mock("@/lib/adminGate", () => ({ isInstanceAdmin: async () => state.admin }));
vi.mock("@/lib/config", () => ({
  loadServerConfig: () => ({ providers: state.lowBelow, features: state.features }),
}));
vi.mock("@paid/printOrder/lib/providers", () => ({
  providersModule: () => true,
  stannpKeySet: () => state.stannp.keySet,
  fetchStannpBalance: async () => {
    if (state.stannp.result instanceof Error) throw state.stannp.result;
    return state.stannp.result;
  },
  listOperatorOrders: async () => state.orders,
}));

const { CACHE_MS, providerAttention, readProviders, resetProvidersCache } = await import("@/lib/providers/read");

const SECRET = "sekrit-token-value";
const calls: string[] = [];
let twilioFails = false;

beforeEach(() => {
  resetProvidersCache();
  calls.length = 0;
  twilioFails = false;
  state.admin = true;
  state.lowBelow = {};
  state.features = { sms: { enabled: false }, transcription: { enabled: false }, postcards: { enabled: false } };
  state.stannp = { keySet: true, result: { value: 14.6, currency: "GBP" } };
  state.orders = [];
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_AUTH_TOKEN", SECRET);
  vi.stubEnv("DEEPGRAM_API_KEY", SECRET);
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("twilio")) {
      if (twilioFails) return new Response("no", { status: 401 });
      return Response.json({ balance: "23.4100", currency: "USD" });
    }
    if (String(url).endsWith("/v1/projects")) return Response.json({ projects: [{ project_id: "p1" }] });
    return Response.json({ balances: [{ amount: 100.5, units: "usd" }, { amount: 60.53, units: "usd" }] });
  });
});

const row = (rows: { id: string }[], id: string) => rows.find((one) => one.id === id) as never as Record<string, any>;

describe("readProviders", () => {
  test("shows real figures for Stannp, Twilio and Deepgram, and a link only for the rest", async () => {
    const { rows } = await readProviders();
    expect(row(rows, "stannp")).toMatchObject({ state: "ok", amount: { value: 14.6, currency: "GBP" } });
    expect(row(rows, "twilio")).toMatchObject({ state: "ok", amount: { value: 23.41, currency: "USD" } });
    expect(row(rows, "deepgram")).toMatchObject({ state: "ok", amount: { value: 161.03, currency: "USD" } });
    for (const id of ["anthropic", "gelato", "meta"]) {
      expect(row(rows, id)).toMatchObject({ state: "link", amount: null });
      expect(row(rows, id).link.href).toMatch(/^https:/);
    }
  });

  test("judges Low only against a configured threshold", async () => {
    expect(row((await readProviders()).rows, "stannp")).toMatchObject({ low: null, lowBelow: null });
    resetProvidersCache();
    state.lowBelow = { stannp: { lowBelow: 20 }, twilio: { lowBelow: 10 } };
    const { rows } = await readProviders();
    expect(row(rows, "stannp").low).toBe(true);
    expect(row(rows, "twilio").low).toBe(false);
  });

  test("no key: simulated sample in a dry-run backend, otherwise not set up", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    state.features.sms = { enabled: true, backend: "dry-run" };
    const { rows } = await readProviders();
    expect(row(rows, "twilio")).toMatchObject({ state: "simulated", amount: { currency: "USD" } });
    expect(row(rows, "deepgram")).toMatchObject({ state: "not_set_up", amount: null });
    expect(calls).toEqual([]);
  });

  test("a failed read keeps the last good figure and its time, never a fresh-looking one", async () => {
    const first = new Date("2026-10-03T08:00:00Z");
    await readProviders({ now: first });
    twilioFails = true;
    const later = new Date("2026-10-03T09:00:00Z");
    const { rows } = await readProviders({ refresh: true, now: later });
    expect(row(rows, "twilio")).toMatchObject({
      state: "failed",
      amount: { value: 23.41 },
      readAt: first.toISOString(),
      error: "HTTP 401",
    });
  });

  test("a failure with nothing read before has no figure", async () => {
    twilioFails = true;
    expect(row((await readProviders()).rows, "twilio")).toMatchObject({ state: "failed", amount: null, readAt: null });
  });

  test("four-hour cache, and Refresh bypasses it", async () => {
    const t0 = new Date("2026-10-03T08:00:00Z");
    await readProviders({ now: t0 });
    const after = calls.length;
    await readProviders({ now: new Date(t0.getTime() + CACHE_MS - 1) });
    expect(calls.length).toBe(after);
    await readProviders({ now: new Date(t0.getTime() + 1000), refresh: true });
    expect(calls.length).toBe(after * 2);
    await readProviders({ now: new Date(t0.getTime() + 1000 + CACHE_MS) });
    expect(calls.length).toBe(after * 3);
  });

  test("no credential appears anywhere in what is returned", async () => {
    state.stannp.result = new Error("HTTP 500");
    const report = await readProviders();
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });
});

describe("providerAttention", () => {
  test("low balance, failed read and refused order become Needs you entries; no threshold, no entry", async () => {
    state.lowBelow = { stannp: { lowBelow: 20 } };
    twilioFails = true;
    state.orders = [
      { id: "o1", owner: "ana", kind: "photobook", status: "Refused", createdAt: "2026-10-01T10:00:00Z", attention: "refused" },
      { id: "o2", owner: "bo", kind: "postcard", status: "Failed", createdAt: "2026-10-01T10:00:00Z", attention: "failed" },
      { id: "o3", owner: "cy", kind: "photobook", status: "Shipped", createdAt: "2026-10-01T10:00:00Z", attention: null },
    ];
    const report = await readProviders();
    const found = providerAttention(report, new Set(["o2"]));
    expect(found.map((one) => one.id)).toEqual(["provider:stannp:low", "provider:twilio:read", "order:o1"]);
    expect(found[0].title).toBe("Stannp balance is GBP 14.60, below 20.00");
    expect(found[1].detail).toBe("HTTP 401.");
  });
});

describe("the route", () => {
  test("a 404 to everybody but the operator, an answer without keys for the operator", async () => {
    const { GET, POST } = await import("@/app/api/admin/providers/route");
    state.admin = false;
    expect((await GET()).status).toBe(404);
    expect((await POST()).status).toBe(404);
    expect(calls).toEqual([]);
    state.admin = true;
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(SECRET);
  });
});
