import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * The third answer — B560, repointed onto v2 for B1612.
 *
 * A model was told *"I don't have any record of what we spent up there, we just
 * paid the homestay lady cash at the end"* and wrote `"costs": false` for both
 * days, because a refusal it could not pass left it one door. The journal then
 * said no money was spent on days somebody had paid cash for.
 *
 * Warning it in bold did not work — it declined again and reported "no false
 * record was created". So the contract gained the answer reality already had:
 * *there was some and nobody has it*, kept apart from *there was none*.
 *
 * v1 said this with two different top-level markers (`without`/`unrecorded`)
 * and two different decline spellings (`costs: false` / `costs: "unknown"`).
 * v2 retires both: there is one `declined` map, everywhere, and the
 * distinction this ticket exists to protect now lives entirely in the
 * REASON TEXT a caller writes — "nothing was spent" reads differently from
 * "the receipts are lost" to the next person who opens the day, even though
 * both are simply `declined.costs`. That is the property these tests hold
 * down: the two statements remain genuinely distinguishable, and supplying a
 * real answer retracts whichever of them was standing (T6, already proven
 * generically in api-v2-days.test.ts — these tests are B560's specific
 * wording claim, not a second copy of T6).
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP_ID = "reise";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.7.${calls % 250}`, ...extra };
}

async function token(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

function fullTrip(): Record<string, unknown> {
  return {
    id: TRIP_ID,
    title: "Reise",
    dates: { from: "2026-09-01", to: "2026-09-05" },
    visibility: "private",
    people: [{ name: "Alex B", email: OWNER_EMAIL }],
    teaser: true,
    declined: {
      rates: "no foreign currency tracked",
      costs: "no budget tracked",
      plan: "no planned route recorded",
      days: "days are written one at a time",
      translations: "single-language journal",
      accent: "default accent",
      figures: "no walking figures drawn",
      tagline: "no subtitle written",
      intro: "no opening prose written",
      buddies: "travelling solo",
    },
  };
}

/** Every declinable this day is not, minus `costs` (what these tests are
 * about) and `coordinates` (`fullDay` always supplies a real one below). */
function dayDeclines(): Record<string, string> {
  return {
    media: "no photographs attached",
    weather: "weather was not asked for",
    time: "time of day not recorded",
    timezone: "no timezone established",
    location: "no specific location named",
    country: "no country named",
    countryCode: "no country code named",
    transportMode: "no transport leg happened",
    tags: "no tags applied",
    translations: "single-language journal",
    visibility: "no narrower visibility set",
  };
}

function fullDay(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "2026-09-02-sapa",
    title: "Sapa",
    date: "2026-09-02",
    content: "Zwei Tage unterwegs.",
    status: "draft",
    coordinates: { lat: 22.34, lng: 103.84 },
    declined: dayDeclines(),
    ...overrides,
  };
}

async function putTrip() {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}`, {
      method: "PUT",
      headers: headers({ authorization: `Bearer ${await token()}` }),
      body: JSON.stringify(fullTrip()),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function putDay(body: Record<string, unknown>, opts: { ifMatch?: string } = {}) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const slug = String(body.slug ?? "2026-09-02-sapa");
  const response = await PUT(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "PUT",
      headers: headers({
        authorization: `Bearer ${await token()}`,
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function patchDay(slug: string, body: Record<string, unknown>, opts: { ifMatch?: string } = {}) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PATCH(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      method: "PATCH",
      headers: headers({
        authorization: `Bearer ${await token()}`,
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

async function getDay(slug: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP_ID}/days/${slug}`, {
      headers: headers({ authorization: `Bearer ${await token()}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP_ID, slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Body };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-unrecorded-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "unrecorded-test-secret-b560";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { createJournal } = await import("@/lib/journals");
  const created = createJournal({
    username: OWNER,
    title: "Alex",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Alex B",
    ownerNickname: "Alex",
  });
  if (!created.ok) throw new Error(created.message);

  await putTrip();
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
  test("declining with 'the figures are lost' is accepted, and satisfies the contract", async () => {
    const made = await putDay(fullDay({ declined: { ...dayDeclines(), costs: "the receipts are lost" } }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
  });

  test("says so in its own words, distinguishable from a day that genuinely had none", async () => {
    await putDay(fullDay({ declined: { ...dayDeclines(), costs: "the receipts are lost" } }));
    const readLost = await getDay("2026-09-02-sapa");
    expect((readLost.body.declined as Record<string, string>).costs).toBe("the receipts are lost");

    await putDay(
      fullDay({ slug: "2026-09-03-hanoi", date: "2026-09-03", declined: { ...dayDeclines(), costs: "nothing was spent" } }),
    );
    const readNone = await getDay("2026-09-03-hanoi");
    expect((readNone.body.declined as Record<string, string>).costs).toBe("nothing was spent");

    // Same field, two different truths — the property B560 exists to keep
    // sayable at all, now told apart by the reason itself rather than by
    // which top-level key it landed under.
    expect((readLost.body.declined as Record<string, string>).costs).not.toBe(
      (readNone.body.declined as Record<string, string>).costs,
    );
  });

  test("the refusal offers it, so a caller with no figure has somewhere to go", async () => {
    const refused = await putDay(fullDay({ declined: dayDeclines() /* costs left unanswered */ }));
    expect(refused.status).toBe(422);
    const missing = (refused.body.details as { missing?: { field: string; why_required: string }[] })?.missing ?? [];
    const costsRow = missing.find((m) => m.field === "costs");
    expect(costsRow).toBeDefined();
    // v2's own wording for the same two ways out v1 spelled "unknown" and
    // "false" — both still named in the one message a caller reads.
    expect(costsRow!.why_required).toMatch(/figures lost/);
    expect(costsRow!.why_required).toMatch(/nothing spent/);
  });

  test("a value sent later retracts the decline — 'lost' or 'none', it does not matter which", async () => {
    await putDay(fullDay({ declined: { ...dayDeclines(), costs: "the receipts are lost" } }));
    const { etag } = await getDay("2026-09-02-sapa");
    const patched = await patchDay(
      "2026-09-02-sapa",
      { costs: [{ label: "Homestay", amount: 40, currency: "EUR" }] },
      { ifMatch: etag ?? undefined },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const read = await getDay("2026-09-02-sapa");
    expect((read.body.declined as Record<string, string> | undefined)?.costs).toBeUndefined();
    expect((read.body.costs as unknown[]).length).toBe(1);
  });

  test("and each reason can replace the other — declining again overwrites the stored text", async () => {
    await putDay(fullDay({ declined: { ...dayDeclines(), costs: "nothing was spent" } }));
    const { etag } = await getDay("2026-09-02-sapa");
    const patched = await patchDay(
      "2026-09-02-sapa",
      { declined: { costs: "the receipts are lost, after all" } },
      { ifMatch: etag ?? undefined },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const read = await getDay("2026-09-02-sapa");
    expect((read.body.declined as Record<string, string>).costs).toBe("the receipts are lost, after all");
  });

  test("an empty reason is refused rather than read as a real decline", async () => {
    const refused = await putDay(fullDay({ declined: { ...dayDeclines(), costs: "" } }));
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("costs");
  });
});
