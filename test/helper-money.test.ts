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
import { dayToJson, type DayFile } from "@/lib/api/v2/documents";
import { writeTripFixture } from "./fixtures/content";

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

  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
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
  writeTripFixture("alex", {
    id: "reise",
    title: "Die Reise",
    start: "2026-05-01",
    end: "2026-05-10",
    visibility: "private",
    // A costs section has to already exist for `patchCosts` to amend it
    // (PATCH, never PUT — see lib/api/costs.ts); "guests" is a real,
    // narrower value rather than a fixture-only placeholder.
    //
    // FINDING (not a fixture problem — reported alongside this repoint):
    // this shape — a costs section with `visibility` and no `budget` yet —
    // is exactly what a costs.md with empty frontmatter used to mean, and
    // it is also exactly what `createTrip`'s own v1 door writes for
    // `costsVisibility: "guests"` (lib/tripWrite.ts, the `as TripFile["costs"]`
    // cast there says as much). `readCostsFile` (lib/costs.ts:96) crashes on
    // it — `section.budget.days` with `section.budget` undefined — so two
    // tests below that go through that path ("a cost outside the total
    // joins it...", "a preparation cost is appended...") fail with a
    // TypeError, not a wrong assertion. This is a real bug the v2 migration
    // introduced/exposed, not something this repoint can route around.
    costsVisibility: "guests",
  });
  // B1630: `writeDayFixture` (test/fixtures/content.ts) has no notion of a
  // day's own `costs:` list — its DayFixture models title/date/location/
  // media/visibility, not per-day cost entries, so this writes the v2 JSON
  // shape directly through the same production serialiser (`dayToJson`)
  // instead of going through the narrower helper. Reported as a finding.
  const entriesDir = path.join(dir, "alex", "trips", "reise", "entries");
  fs.mkdirSync(entriesDir, { recursive: true });
  const dayTwo: DayFile = {
    slug: "day-two",
    title: "Day two",
    date: "2026-05-02",
    content: "Some words.",
    status: "draft",
    costs: [
      { label: "Dinner", amount: 20, category: "food", currency: "CHF" },
      { label: "Market", amount: 400, category: "other", currency: "THB" },
    ],
  };
  fs.writeFileSync(path.join(entriesDir, "2026-05-02-day-two.json"), dayToJson(dayTwo));
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
      path.join(dir, "alex", "trips", "reise", "trip.json"),
      "utf8",
    );
    expect(costsFile).toContain('"total": 1000');
    expect(costsFile).toContain('"days": 10');
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
      path.join(dir, "alex", "trips", "reise", "trip.json"),
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
