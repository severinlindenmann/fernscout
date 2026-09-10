import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { runTool } from "@/lib/helper/tools";
import { sessionStats } from "@/lib/helper/sessions";
import type { Say } from "@/lib/helper/intents";

/**
 * `set_rate` and `set_budget` — B1042's two new money tools.
 *
 * `set_rate` is the open half of B960: a trip made through the conversation
 * has no `rates:` block, so a cost in anything but the journal's own currency
 * sits outside every total until somebody gives it a rate. This drives the
 * whole thing end to end — a cost with nowhere to convert to, the rate
 * proposed and pressed, and `trip_costs` read again — because that round trip
 * is the only thing that actually proves the feature does what it is for.
 *
 * `set_budget` amends `costs.md`'s other two fields, the planned budget and
 * one thing paid for before leaving, through the same `PATCH` the API door
 * uses.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { POST: setRate } = await import("@/app/api/helper/[user]/trip/rates/route");
const { POST: setBudget } = await import("@/app/api/helper/[user]/trip/budget/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-money-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-money-secret-b1042";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    [
      "---",
      "id: reise",
      "title: Die Reise",
      'start: "2026-05-01"',
      'end: "2026-05-10"',
      "visibility: private",
      "---",
      "",
      "Intro.",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-02-day-two.md"),
    [
      "---",
      'title: "Day two"',
      'date: "2026-05-02"',
      "status: draft",
      "costs:",
      '  - { label: "Dinner", amount: 20, category: "food", currency: "CHF" }',
      '  - { label: "Market", amount: 400, category: "other", currency: "THB" }',
      "---",
      "",
      "Some words.",
    ].join("\n"),
  );
  // `patchCosts` amends an existing costs.md and refuses to create one — the
  // instruction behind `set_budget` is "PATCH, never PUT" (see the tool's own
  // comment). A blank one here stands in for the file an owner already has,
  // from the API or from `add-a-trip`; a trip with no costs.md at all is not
  // something this tool can start on its own, which the report notes.
  fs.writeFileSync(path.join(dir, "alex", "trips", "reise", "costs.md"), "---\n---\n");
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** What the browser posts when somebody presses — `components/HelperAsk.tsx`,
 *  `accept()`: the tool's own arguments, then the fields as they stand. */
function pressed(proposal: {
  arguments: Record<string, string>;
  fields: { name: string; value: string }[];
}) {
  return {
    ...proposal.arguments,
    ...Object.fromEntries(proposal.fields.map((field) => [field.name, field.value])),
  };
}

async function propose(tool: string, args: Record<string, string> = {}) {
  const ran = await runTool("alex", tool, { trip: "reise", ...args }, say, "2026-09-07");
  if (!ran.proposal) throw new Error(`${tool} proposed nothing`);
  return ran.proposal;
}

function post(route: (request: Request, context: typeof params) => Promise<Response>, body: unknown) {
  return route(
    new Request("https://t.test/api/helper/alex/trip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

async function tripCosts(): Promise<{
  total: number;
  notInTheTotal: { currency: string; amount: number; items: number }[];
  budget?: { total: number; days: number; perDay: number; remaining: number };
}> {
  return (await runTool("alex", "trip_costs", { trip: "reise" }, say, "2026-09-07"))
    .result as {
    total: number;
    notInTheTotal: { currency: string; amount: number; items: number }[];
    budget?: { total: number; days: number; perDay: number; remaining: number };
  };
}

describe("set_rate — the open half of B960, closed", () => {
  test("a cost outside the total joins it once a rate is given", async () => {
    const before = await tripCosts();
    expect(before.total).toBe(20);
    expect(before.notInTheTotal).toEqual([{ currency: "THB", amount: 400, items: 1 }]);

    const proposal = await propose("set_rate", { currency: "thb", rate: "0.028" });
    const answered = await post(setRate, pressed(proposal));
    expect(answered.status).toBe(200);
    expect((await answered.json()).rates).toEqual({ THB: 0.028 });

    const after = await tripCosts();
    // 20 CHF, plus 400 THB at 0.028 — 11.2 CHF — with nothing left outside.
    expect(after.total).toBeCloseTo(31.2, 5);
    expect(after.notInTheTotal).toEqual([]);
  });

  test("a rate that is not a number is refused, and the refusal leaves a row", async () => {
    const answered = await post(setRate, { trip: "reise", currency: "thb", rate: "not-a-number" });
    expect(answered.status).toBe(400);
    expect((await answered.json()).error).toBe("invalid_rate");

    const [stat] = await sessionStats("2020-01-01");
    expect(stat.refused).toBeGreaterThan(0);
  });
});

describe("trip_costs — B1305, scenario-costs.md defect C", () => {
  test("carries the budget once one is set, rather than dropping it", async () => {
    const before = await tripCosts();
    expect(before.budget).toBeUndefined();

    const proposal = await propose("set_budget", { total: "1000", days: "10", currency: "CHF" });
    const answered = await post(setBudget, pressed(proposal));
    expect(answered.status).toBe(200);

    const after = await tripCosts();
    expect(after.budget).toBeDefined();
    expect(after.budget?.total).toBe(1000);
    expect(after.budget?.days).toBe(10);
  });
});

describe("set_budget", () => {
  test("a planned budget is written through PATCH, not PUT", async () => {
    const proposal = await propose("set_budget", { total: "1000", days: "10", currency: "CHF" });
    const answered = await post(setBudget, pressed(proposal));
    expect(answered.status).toBe(200);
    expect((await answered.json()).changed).toEqual(["budget"]);

    const costsFile = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "costs.md"),
      "utf8",
    );
    expect(costsFile).toContain("total: 1000");
    expect(costsFile).toContain("days: 10");
  });

  test("a preparation cost is appended, not replacing what is already there", async () => {
    // One already on the file, written by an earlier call.
    await post(setBudget, {
      trip: "reise",
      prepLabel: "Visa",
      prepAmount: "60",
      prepCurrency: "CHF",
    });

    const proposal = await propose("set_budget", {
      prepLabel: "Vaccinations",
      prepAmount: "40",
      prepCurrency: "CHF",
    });
    const answered = await post(setBudget, pressed(proposal));
    expect(answered.status).toBe(200);

    const costsFile = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "costs.md"),
      "utf8",
    );
    expect(costsFile).toContain("Visa");
    expect(costsFile).toContain("Vaccinations");
  });

  test("neither half given is refused, and the refusal leaves a row", async () => {
    const answered = await post(setBudget, { trip: "reise" });
    expect(answered.status).toBe(400);
    expect((await answered.json()).error).toBe("invalid_request");

    const [stat] = await sessionStats("2020-01-01");
    expect(stat.refused).toBeGreaterThan(0);
  });
});
