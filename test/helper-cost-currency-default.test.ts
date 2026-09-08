import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import type { Say } from "@/lib/helper/intents";
import { runTool } from "@/lib/helper/tools";

/**
 * **A currency nobody said is a guess, and the guess is shown** — B973.
 *
 * "We spent 15 on the museum" used to reach the route as `currency: ""`,
 * which `lib/costs.ts` reads as the trip's base currency, silently. The card
 * a person presses now shows that guess before the press rather than after.
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

let dir: string;
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-cost-currency-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-cost-currency-b973";
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
      "rates:",
      "  EUR: 0.95",
      "---",
      "",
      "Intro.",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-first.md"),
    ["---", 'title: "first"', 'date: "2026-05-01"', "status: draft", "---", "", "Worte.", ""].join(
      "\n",
    ),
  );
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

function currencyField(fields: { name: string; value: string; options?: unknown[] }[]) {
  const field = fields.find((one) => one.name === "currency");
  if (!field) throw new Error("no currency field on the proposal");
  return field;
}

describe("add_cost's currency field", () => {
  test("with none said, shows the trip's base currency rather than blank", async () => {
    const ran = await runTool(
      "alex",
      "add_cost",
      { trip: "reise", slug: "first", label: "Museum", amount: "15" },
      say,
      "2026-05-01",
    );
    if (!ran.proposal) throw new Error("add_cost proposed nothing");
    const field = currencyField(ran.proposal.fields);
    expect(field.value).toBe("CHF");
    expect(field.options?.length).toBeGreaterThan(0);
  });

  test("with one said, keeps it rather than the base", async () => {
    const ran = await runTool(
      "alex",
      "add_cost",
      { trip: "reise", slug: "first", label: "Museum", amount: "15", currency: "eur" },
      say,
      "2026-05-01",
    );
    if (!ran.proposal) throw new Error("add_cost proposed nothing");
    const field = currencyField(ran.proposal.fields);
    expect(field.value).toBe("EUR");
  });
});
