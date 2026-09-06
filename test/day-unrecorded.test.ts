import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";
import { POST as createDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/route";
import { GET as readDayRoute, PATCH as editDayRoute } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route";

/**
 * The third answer — B560.
 *
 * A model was told *"I don't have any record of what we spent up there, we just
 * paid the homestay lady cash at the end"* and wrote `"costs": false` for both
 * days, because a refusal it could not pass left it one door. The journal then
 * said no money was spent on days somebody had paid cash for.
 *
 * Warning it in bold did not work — it declined again and reported "no false
 * record was created". So the contract gained the answer reality already had:
 * *there was some and nobody has it*, kept apart from *there was none* at every
 * point a reader or an agent might confuse them.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";

async function token(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

async function trip() {
  return createTripRoute(
    new Request("https://t.test/api/v1/alex/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "reise", title: "Reise", start: "2026-09-01", end: "2026-09-05" }),
    }),
    { params: Promise.resolve({ user: "alex" }) },
  );
}

async function day(body: unknown) {
  const response = await createDayRoute(
    new Request("https://t.test/api/v1/alex/trips/reise/days", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function readBack(slug: string) {
  const response = await readDayRoute(
    new Request(`https://t.test/api/v1/alex/trips/reise/days/${slug}`, {
      headers: { authorization: `Bearer ${await token()}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  return (await response.json()) as Record<string, unknown>;
}

const base = { title: "Sapa", date: "2026-09-02", content: "Zwei Tage unterwegs." };
const placed = { ...base, lat: 22.34, lng: 103.84 };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-unrecorded-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "unrecorded-test-secret-b560";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "de",
      locales: ["de"],
      baseCurrency: "CHF",
    }),
  );
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

describe("a day whose costs nobody recorded", () => {
  test("is accepted, and satisfies the trip's contract", async () => {
    await trip();
    const made = await day({ ...placed, costs: "unknown" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
  });

  test("says so in its own words, not in the words for having none", async () => {
    await trip();
    await day({ ...placed, costs: "unknown" });
    const read = await readBack("sapa");
    expect(read.unrecorded).toEqual(["costs"]);
    expect(read.without).toBeUndefined();
  });

  test("is distinguishable from a day that genuinely had none", async () => {
    await trip();
    await day({ ...placed, costs: false });
    const read = await readBack("sapa");
    expect(read.without).toEqual(["costs"]);
    expect(read.unrecorded).toBeUndefined();
  });

  test("the refusal offers it, so a caller with no figure has somewhere to go", async () => {
    await trip();
    const refused = await day(base);
    expect(refused.status).toBe(422);
    const said = JSON.stringify(refused.body);
    expect(said).toContain("unknown");
    expect(said).toContain("nobody has the figures");
  });

  test("a value sent later retracts it", async () => {
    await trip();
    await day({ ...placed, costs: "unknown" });
    const patched = await editDayRoute(
      new Request("https://t.test/api/v1/alex/trips/reise/days/sapa", {
        method: "PATCH",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ costs: [{ label: "Homestay", amount: 40, currency: "EUR" }] }),
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise", slug: "sapa" }) },
    );
    expect(patched.status).toBe(200);
    const read = await readBack("sapa");
    expect(read.unrecorded).toBeUndefined();
    expect((read.costs as unknown[]).length).toBe(1);
  });

  test("and each answer retracts the other", async () => {
    await trip();
    await day({ ...placed, costs: false });
    await editDayRoute(
      new Request("https://t.test/api/v1/alex/trips/reise/days/sapa", {
        method: "PATCH",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ costs: "unknown" }),
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise", slug: "sapa" }) },
    );
    const read = await readBack("sapa");
    expect(read.unrecorded).toEqual(["costs"]);
    expect(read.without).toBeUndefined();
  });

  test("a word that is neither is refused rather than read as absent", async () => {
    await trip();
    const refused = await day({ ...placed, costs: "dunno" });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("costs");
  });
});
