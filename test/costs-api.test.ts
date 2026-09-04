import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { hasCostsData } from "@/lib/costs";
import {
  DELETE as deleteRoute,
  GET as getRoute,
  PATCH as patchRoute,
  PUT as putRoute,
} from "@/app/api/v1/[user]/trips/[trip]/costs/route";

/**
 * B295 — a costs door: a trip's budget could only ever be written by hand,
 * over SSH or through the `add-a-trip` skill on a local checkout. These
 * tests hold the line on what the ticket names explicitly:
 *
 *  - all four verbs work over REST;
 *  - a hand-written costs.md — comments, key order, flow-vs-block style —
 *    survives a PATCH;
 *  - a zero total, an unknown category and an unknown currency are each
 *    refused with a sentence, not written and read back as if nothing had
 *    happened (B263's failure, which this ticket exists to close);
 *  - DELETE actually removes the costs page (`hasCostsData`, B267).
 */

let dir: string;
const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";

function tripFile(name: string): string {
  return path.join(dir, "alex", "trips", "reise", name);
}

function writeTrip() {
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    tripFile("trip.md"),
    [
      "---",
      "id: reise",
      'title: "Reise"',
      'start: "2026-09-01"',
      'end: "2026-09-05"',
      "status: current",
      "visibility: public",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

async function agentToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

async function call(
  route: typeof getRoute | typeof putRoute | typeof patchRoute | typeof deleteRoute,
  method: string,
  token: string,
  body?: unknown,
) {
  const response = await route(
    new Request("https://t.test/api/v1/alex/trips/reise/costs", {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-costs-api-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "costs-api-test-secret-costs-api-test";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      baseCurrency: "CHF",
    }),
  );
  writeTrip();
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET .../costs", () => {
  test("no costs.md yet reads back as absent, not an error", async () => {
    const token = await agentToken();
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ exists: false, budget: null, costs: [] });
  });

  test("reads back a budget and preparation costs already on disk", async () => {
    fs.writeFileSync(
      tripFile("costs.md"),
      [
        "---",
        "budget: { total: 900, days: 4, currency: CHF }",
        "costs:",
        '  - { label: "Roof box hire", amount: 60, category: "preparation" }',
        "---",
        "",
        "Short trip, short budget.",
        "",
      ].join("\n"),
    );
    const token = await agentToken();
    const { status, body } = await call(getRoute, "GET", token);
    expect(status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.budget).toEqual({ total: 900, days: 4, currency: "CHF" });
    expect((body.costs as unknown[]).length).toBe(1);
    expect(body.body).toBe("Short trip, short budget.");
  });
});

describe("PUT .../costs", () => {
  test("creates costs.md, and it reads back as written", async () => {
    const token = await agentToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      budget: { total: 12000, days: 45, currency: "CHF" },
      costs: [{ label: "Rail pass", amount: 420, category: "preparation" }],
      body: "The rail pass decided everything else.",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(hasCostsData(REF)).toBe(true);

    const read = await call(getRoute, "GET", token);
    expect(read.body.budget).toEqual({ total: 12000, days: 45, currency: "CHF" });
    expect(read.body.body).toBe("The rail pass decided everything else.");
  });

  test("a zero total is refused with a sentence, and nothing is written", async () => {
    const token = await agentToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      budget: { total: 0, days: 45, currency: "CHF" },
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_costs");
    const problems = body.problems as { field: string; expected: string }[];
    expect(problems.some((p) => p.field === "budget.total")).toBe(true);
    expect(problems.find((p) => p.field === "budget.total")?.expected).toMatch(/positive/);
    expect(hasCostsData(REF)).toBe(false);
  });

  test("a missing total is refused the same way", async () => {
    const token = await agentToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      budget: { days: 45 },
    });
    expect(status).toBe(400);
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "budget.total")).toBe(true);
  });

  test("an unknown category is refused by name", async () => {
    const token = await agentToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      budget: { total: 900, days: 4 },
      costs: [{ label: "Mystery spend", amount: 10, category: "shenanigans" }],
    });
    expect(status).toBe(400);
    const problems = body.problems as { field: string; expected: string }[];
    const problem = problems.find((p) => p.field === "costs[0].category");
    expect(problem).toBeDefined();
    expect(problem?.expected).toMatch(/preparation/);
    expect(hasCostsData(REF)).toBe(false);
  });

  test("an unknown currency is refused by name", async () => {
    const token = await agentToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      budget: { total: 900, days: 4, currency: "Swiss Francs" },
    });
    expect(status).toBe(400);
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "budget.currency")).toBe(true);
    expect(hasCostsData(REF)).toBe(false);
  });

  test("a missing budget is refused rather than writing costs with none", async () => {
    const token = await agentToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      costs: [{ label: "Boots", amount: 60, category: "preparation" }],
    });
    expect(status).toBe(400);
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "budget")).toBe(true);
  });

  test("a field this endpoint does not write is refused whole", async () => {
    const token = await agentToken();
    const { status, body } = await call(putRoute, "PUT", token, {
      budget: { total: 900, days: 4 },
      status: "current",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("unsupported_field");
    expect(hasCostsData(REF)).toBe(false);
  });
});

describe("PATCH .../costs: a hand-written file survives", () => {
  test("a comment, key order and flow-vs-block style are untouched by an unrelated change", async () => {
    fs.writeFileSync(
      tripFile("costs.md"),
      [
        "---",
        "budget:",
        "  total: 14800",
        "  days: 43",
        "  currency: CHF",
        "# argued about for a week before anyone agreed",
        "costs:",
        '  - { label: "Rail pass, 21 days", amount: 1180, category: "preparation" }',
        "---",
        "",
        "Nothing has been spent on the road yet.",
        "",
      ].join("\n"),
    );
    const before = fs.readFileSync(tripFile("costs.md"), "utf8");
    const token = await agentToken();

    const { status } = await call(patchRoute, "PATCH", token, {
      body: "Updated: the rail pass is booked.",
    });
    expect(status).toBe(200);

    const after = fs.readFileSync(tripFile("costs.md"), "utf8");
    expect(after).toContain("# argued about for a week before anyone agreed");
    expect(after).toContain("  total: 14800");
    expect(after).toContain("  days: 43");
    expect(after).toContain("  currency: CHF");
    expect(after).toContain('label: "Rail pass, 21 days"');
    expect(after).toContain("Updated: the rail pass is booked.");
    expect(after).not.toContain("Nothing has been spent on the road yet.");
    // Everything before the prose is untouched, byte for byte.
    expect(after.slice(0, before.indexOf("---", 4) + 3)).toBe(before.slice(0, before.indexOf("---", 4) + 3));
  });

  test("changing only the budget leaves a hand-written costs: list alone", async () => {
    fs.writeFileSync(
      tripFile("costs.md"),
      [
        "---",
        "budget: { total: 900, days: 4, currency: CHF }",
        "costs:",
        '  - { label: "Vignette and tolls", amount: 90, category: "transport" }',
        '  - { label: "Roof box hire", amount: 60, category: "preparation" }',
        "---",
        "",
        "Four days is short.",
        "",
      ].join("\n"),
    );
    const token = await agentToken();
    const { status } = await call(patchRoute, "PATCH", token, {
      budget: { total: 1200, days: 4, currency: "CHF" },
    });
    expect(status).toBe(200);

    const after = fs.readFileSync(tripFile("costs.md"), "utf8");
    expect(after).toContain("budget: { total: 1200, days: 4, currency: \"CHF\" }");
    expect(after).toContain('label: "Vignette and tolls"');
    expect(after).toContain('label: "Roof box hire"');
    expect(after).toContain("Four days is short.");
  });

  test("budget: null clears the budget and leaves costs in place", async () => {
    fs.writeFileSync(
      tripFile("costs.md"),
      [
        "---",
        "budget: { total: 900, days: 4, currency: CHF }",
        "costs:",
        '  - { label: "Roof box hire", amount: 60, category: "preparation" }',
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    const token = await agentToken();
    const { status } = await call(patchRoute, "PATCH", token, { budget: null });
    expect(status).toBe(200);

    const after = fs.readFileSync(tripFile("costs.md"), "utf8");
    expect(after).not.toContain("budget:");
    expect(after).toContain('label: "Roof box hire"');
    // The page is still there — only the budget went, not the file.
    expect(hasCostsData(REF)).toBe(true);
  });

  test("a zero total is refused on PATCH too, and the file is untouched", async () => {
    fs.writeFileSync(
      tripFile("costs.md"),
      ["---", "budget: { total: 900, days: 4, currency: CHF }", "---", "", "Body.", ""].join("\n"),
    );
    const before = fs.readFileSync(tripFile("costs.md"), "utf8");
    const token = await agentToken();
    const { status, body } = await call(patchRoute, "PATCH", token, {
      budget: { total: 0, days: 4 },
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_costs");
    expect(fs.readFileSync(tripFile("costs.md"), "utf8")).toBe(before);
  });

  test("PATCHing a trip with no costs.md yet is refused, naming PUT", async () => {
    const token = await agentToken();
    const { status, body } = await call(patchRoute, "PATCH", token, { body: "Anything." });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/PUT/);
  });

  test("an empty body is refused rather than a no-op 200", async () => {
    fs.writeFileSync(
      tripFile("costs.md"),
      ["---", "budget: { total: 900, days: 4 }", "---", "", "Body.", ""].join("\n"),
    );
    const token = await agentToken();
    const { status } = await call(patchRoute, "PATCH", token, {});
    expect(status).toBe(400);
  });
});

describe("DELETE .../costs", () => {
  test("removes costs.md, and the trip has no costs page afterwards", async () => {
    fs.writeFileSync(
      tripFile("costs.md"),
      ["---", "budget: { total: 900, days: 4 }", "---", "", "Body.", ""].join("\n"),
    );
    expect(hasCostsData(REF)).toBe(true);

    const token = await agentToken();
    const { status, body } = await call(deleteRoute, "DELETE", token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, costsPageGone: true });
    expect(fs.existsSync(tripFile("costs.md"))).toBe(false);
    expect(hasCostsData(REF)).toBe(false);
  });

  test("deleting when there is nothing to delete is 404, not a quiet success", async () => {
    const token = await agentToken();
    const { status } = await call(deleteRoute, "DELETE", token);
    expect(status).toBe(404);
  });
});
