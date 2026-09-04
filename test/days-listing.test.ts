import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { createDraft, publishDraft } from "@/lib/api/entries";
import { GET as daysRoute } from "@/app/api/v1/[user]/trips/[trip]/days/route";

/**
 * B296 — the days listing is the one place the caller who wrote a draft is
 * entitled to see it, and it was hiding it: `getAllEntries(ref)` with no
 * options runs through `visible()`, which drops anything with `draft` set.
 * An agent that had just created fifteen days asked for the trip's days and
 * was handed an empty array.
 */

let dir: string;
const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";

function writeTrip() {
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
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

async function listDays(token: string) {
  const response = await daysRoute(
    new Request("https://t.test/api/v1/alex/trips/reise/days", {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  const body = (await response.json()) as {
    days: { slug: string; draft?: boolean }[];
  };
  return { status: response.status, body };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-days-listing-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "days-listing-test-secret-days-listing";
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

const DAY = {
  title: "Erster Tag",
  date: "2026-09-01",
  location: "Bellinzona",
  country: "Switzerland",
  content: "Ankunft am Morgen.",
};

describe("GET .../days: the caller entitled to write here is entitled to see drafts", () => {
  test("a freshly written draft appears in the listing, marked as one", async () => {
    createDraft(REF, DAY);
    const token = await agentToken();
    const { status, body } = await listDays(token);
    expect(status).toBe(200);
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({ slug: "erster-tag", draft: true });
  });

  test("a published day in the same list is not marked", async () => {
    createDraft(REF, DAY);
    publishDraft(REF, "erster-tag");
    const token = await agentToken();
    const { body } = await listDays(token);
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({ slug: "erster-tag" });
    expect(body.days[0]).not.toHaveProperty("draft");
  });

  test("a mix of both is fully listed, each marked correctly", async () => {
    createDraft(REF, DAY);
    publishDraft(REF, "erster-tag");
    createDraft(REF, { ...DAY, title: "Zweiter Tag", date: "2026-09-02" });
    const token = await agentToken();
    const { body } = await listDays(token);
    const bySlug = new Map(body.days.map((d) => [d.slug, d]));
    expect(bySlug.get("erster-tag")?.draft).toBeUndefined();
    expect(bySlug.get("zweiter-tag")?.draft).toBe(true);
  });
});
