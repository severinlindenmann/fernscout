import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { storeInboxFile } from "@/lib/inbox";
import { createTrip } from "@/lib/tripWrite";

/**
 * B1822, spec §7.7 — "an unrecognised bank reaches the same decide step
 * through the generic column mapping … it is never a dead end." And, its own
 * companion: a bank the repository already knows should never make a person
 * pick columns it already knows how to read.
 *
 * Both of these are free — no model, no credit, no consent — because reading
 * a header row and detecting a known format are things `importers/costs/`
 * already does for nothing; only the model-assisted *suggestion* at
 * `POST /api/helper/[user]/statement` costs anything, and this door never
 * calls it.
 */

const OWNER_EMAIL = "owner@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST: applyRoute } = await import("@/app/api/helper/[user]/statement/apply/route");

let dir: string;
const params = { params: Promise.resolve({ user: "owner" }) };

function json(url: string, body: unknown) {
  return new Request(`https://t.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function stage(filename: string, contents: string): string {
  return storeInboxFile("owner", "files", filename, Buffer.from(contents), {}).entry.id;
}

const REVOLUT = [
  "Personal · CHF (CHF)",
  "Date,Description,Category,Money in/out,Money in/out,Balance",
  '"Jun 22, 2026",Padaria Central,Restaurants,-€12.40,-11.65 CHF,1000.00 CHF',
  '"Jun 23, 2026",Hotel Boa Vista,Travel,-240.00 CHF,-240.00 CHF,760.00 CHF',
  "Total,,,,,",
].join("\n");

const UNKNOWN_BANK = [
  "Buchungstag,Wertstellung,Verwendungszweck,Betrag,Whrg.,Konto",
  "04.03.2026,05.03.2026,Kiosk am Hafen,-12.40,EUR,Everyday",
  "05.03.2026,06.03.2026,Pension Seeblick,-74.00,EUR,Everyday",
].join("\n");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-statement-unrecognized-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-statement-unrecognized-secret-b1822";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "owner"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "owner", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "EUR",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createTrip("owner", { id: "the-islands", title: "The islands", start: "2026-03-01", end: "2026-06-30" });
  if (!created.ok) throw new Error(`trip fixture failed: ${created.message}`);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a known bank, with no format named", () => {
  test("is read for free, no mapping needed", async () => {
    const id = stage("statement.csv", REVOLUT);
    const answer = await read(
      await applyRoute(json("/api/helper/owner/statement/apply", { inbox: id, trip: "the-islands" }), params),
    );
    expect(answer.status).toBe(200);
    expect(answer.body.format).toBe("revolut");
    expect(answer.body.read).toBe(2);
    expect(answer.body.spending).toHaveLength(2);
  });
});

describe("an unrecognised bank, with no mapping given yet", () => {
  test("gets its header back, free, rather than a dead end", async () => {
    const id = stage("statement.csv", UNKNOWN_BANK);
    const answer = await read(
      await applyRoute(json("/api/helper/owner/statement/apply", { inbox: id, trip: "the-islands" }), params),
    );
    expect(answer.status).toBe(200);
    expect(answer.body.unrecognized).toBe(true);
    expect(answer.body.header).toEqual(["Buchungstag", "Wertstellung", "Verwendungszweck", "Betrag", "Whrg.", "Konto"]);
    expect(answer.body.sample).toHaveLength(2);
  });

  test("reaches the same peek shape once a mapping is confirmed by hand", async () => {
    const id = stage("statement.csv", UNKNOWN_BANK);
    const answer = await read(
      await applyRoute(
        json("/api/helper/owner/statement/apply", {
          inbox: id,
          trip: "the-islands",
          mapping: {
            date: "Buchungstag",
            amount: "Betrag",
            description: "Verwendungszweck",
            currency: "Whrg.",
            dateFormat: "DD.MM.YYYY",
          },
        }),
        params,
      ),
    );
    expect(answer.status).toBe(200);
    expect(answer.body.read).toBe(2);
    expect(answer.body.spending).toHaveLength(2);
    expect((answer.body.spending as { label: string }[])[0].label).toBe("Kiosk am Hafen");
  });
});
