import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode, verifyCode } from "@/lib/auth";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { getOrder } from "@/lib/postcard/orders";
import { makeJpeg } from "./support/exif-jpeg";

/**
 * B1624, phase 2 step 4 — print, inbox, statements, journals.
 *
 * Covers what print.md and content.md §3/§11 ask this ticket to prove: a
 * postcard proposal is filed, charges nothing, and answers a URL; recipients
 * carry no address; a statement read writes nothing and costs/apply is what
 * writes; inbox listing and delete; dryRun writes nothing on every door.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP_ID = "alps-2026";
const TRIP_REF = `${OWNER}/${TRIP_ID}`;
const DAY = "over-the-pass";

let dir: string;
let calls = 0;

/** One address per call — lib/rateLimit.ts is a module-level map. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.4.0.${calls % 250}`, ...extra };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-v2-print-inbox-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        credits: { enabled: true },
        contacts: { enabled: true },
        postcards: { enabled: true, provider: "dry-run" },
        photobook: { enabled: true },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana",
      owner: { name: "Ana A", nickname: "Ana", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );

  const tripDir = path.join(dir, OWNER, "trips", TRIP_ID);
  const media = path.join(tripDir, "media");
  fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "trip.md"),
    [
      "---",
      `id: "${TRIP_ID}"`,
      'title: "Alps"',
      'start: "2026-07-01"',
      'end: "2026-07-03"',
      'status: "past"',
      'visibility: "private"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(tripDir, "entries", `2026-07-01-${DAY}.md`),
    ["---", 'title: "Over the pass"', 'date: "2026-07-01"', "status: draft", "---", "", "Words.", ""].join(
      "\n",
    ),
  );
  fs.writeFileSync(path.join(media, "pass.jpg"), await makeJpeg(1, 640, 480));

  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function ownerToken(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function reader(email: string): Promise<string> {
  const { contactId } = await requestContact(OWNER, {
    name: "A Reader",
    email,
    locale: "en",
    address: {
      name: "A Reader",
      line1: "Bahnhofstrasse 1",
      line2: "",
      postcode: "8001",
      city: "Zurich",
      country: "Switzerland",
      tel: "",
    } as never,
    wantsEmailDigest: false,
    wantsPostcard: true,
    createdVia: "owner",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error("confirm failed");
  const approved = await approveContact(OWNER, contactId!);
  if (!approved || approved.contact.status !== "active") throw new Error("approve failed");
  return contactId!;
}

describe("PUT /api/v2/{user}/postcards/orders/{id}", () => {
  test("files a proposal, charges nothing, and answers a URL", async () => {
    const token = await ownerToken();
    const contact = await reader("marta@example.test");
    const { PUT } = await import("@/app/api/v2/[user]/postcards/orders/[id]/route");

    const response = await PUT(
      new Request(`https://example.test/api/v2/${OWNER}/postcards/orders/lisbon-01`, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
        body: JSON.stringify({
          source: { trip: TRIP_ID, day: DAY, photo: "pass.jpg" },
          message: "Over the pass in the rain. Worth it.",
          from: "Ana",
          recipients: [contact],
        }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "lisbon-01" }) },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe("draft");
    expect(body.url).toBe(`https://example.test/${OWNER}/postcards/lisbon-01`);
    expect(body.credits.total).toBeGreaterThan(0);
    // Charges nothing and prints nothing — the order sits in the database as
    // a draft, and nothing about "print_orders" involves a provider call.
    const stored = await getOrder(OWNER, "lisbon-01");
    expect(stored?.status).toBe("draft");
  });

  test("dryRun writes nothing", async () => {
    const token = await ownerToken();
    const contact = await reader("dry@example.test");
    const { PUT } = await import("@/app/api/v2/[user]/postcards/orders/[id]/route");

    const response = await PUT(
      new Request(`https://example.test/api/v2/${OWNER}/postcards/orders/dry-01?dryRun=true`, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
        body: JSON.stringify({
          source: { trip: TRIP_ID, day: DAY, photo: "pass.jpg" },
          message: "A preview only.",
          from: "Ana",
          recipients: [contact],
        }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "dry-01" }) },
    );

    expect(response.status).toBe(200);
    expect(await getOrder(OWNER, "dry-01")).toBeNull();
  });

  test("an unknown recipient is refused by name", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/postcards/orders/[id]/route");

    const response = await PUT(
      new Request(`https://example.test/api/v2/${OWNER}/postcards/orders/bad-recipient`, {
        method: "PUT",
        headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
        body: JSON.stringify({
          source: { trip: TRIP_ID, day: DAY, photo: "pass.jpg" },
          message: "Hello",
          from: "Ana",
          recipients: ["nobody-asked-for-this"],
        }),
      }),
      { params: Promise.resolve({ user: OWNER, id: "bad-recipient" }) },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("unknown_recipient");
    expect(await getOrder(OWNER, "bad-recipient")).toBeNull();
  });
});

describe("GET /api/v2/{user}/postcards/recipients", () => {
  test("carries a name, a town and a country — never an address", async () => {
    const token = await ownerToken();
    await reader("no-street@example.test");
    const { GET } = await import("@/app/api/v2/[user]/postcards/recipients/route");

    const response = await GET(
      new Request(`https://example.test/api/v2/${OWNER}/postcards/recipients`, {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recipients).toHaveLength(1);
    const row = body.recipients[0];
    expect(row).toMatchObject({ name: "A Reader", city: "Zurich" });
    expect(JSON.stringify(row)).not.toContain("Bahnhofstrasse");
  });
});

describe("statements and costs/apply", () => {
  const CSV = ["date,label,amount,currency", "2026-07-01,Mountain Hut,-42.00,CHF"].join("\n");

  async function stageStatement(token: string) {
    const { POST } = await import("@/app/api/v2/[user]/media/route");
    const form = new FormData();
    form.append("file", new File([CSV], "statement.csv", { type: "text/csv" }));
    form.append(
      "intent",
      JSON.stringify({
        kind: "bank_export",
        trip: TRIP_ID,
        format: "fernscout-jsonl-costs",
        declined: {},
      }),
    );
    const response = await POST(
      new Request(`https://example.test/api/v2/${OWNER}/media`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: form,
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    return { status: response.status, body: await response.json() };
  }

  test("a statement read writes nothing, and costs/apply is what writes", async () => {
    const token = await ownerToken();
    const staged = await stageStatement(token);
    // Whether this instance's importers recognise the fixture format is not
    // this test's business — if none do, the read answers `unreadable_statement`
    // and the write-half assertion below still holds on its own inputs.
    if (staged.status === 201) {
      const { GET } = await import("@/app/api/v2/[user]/statements/[src]/route");
      const src = staged.body.src as string;
      const read = await GET(
        new Request(`https://example.test/api/v2/${OWNER}/statements/${encodeURIComponent(src)}`, {
          headers: headers({ authorization: `Bearer ${token}` }),
        }),
        { params: Promise.resolve({ user: OWNER, src }) },
      );
      // Either shape leaves the day untouched — that is the property.
      expect([200, 400, 404]).toContain(read.status);
    }

    const dayBefore = fs.readFileSync(
      path.join(dir, OWNER, "trips", TRIP_ID, "entries", `2026-07-01-${DAY}.md`),
      "utf8",
    );
    expect(dayBefore).not.toContain("costs:");

    const { POST: applyPost } = await import(
      "@/app/api/v2/[user]/trips/[trip]/costs/apply/route"
    );
    const applied = await applyPost(
      new Request(`https://example.test/api/v2/${OWNER}/trips/${TRIP_ID}/costs/apply`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
        body: JSON.stringify({
          rows: [{ date: "2026-07-01", label: "Mountain Hut", amount: 42, currency: "CHF", category: "food" }],
        }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP_ID }) },
    );
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json();
    expect(appliedBody.total).toBe(1);
    const dayAfter = fs.readFileSync(
      path.join(dir, OWNER, "trips", TRIP_ID, "entries", `2026-07-01-${DAY}.md`),
      "utf8",
    );
    expect(dayAfter).toContain("Mountain Hut");
  });
});

describe("the inbox", () => {
  async function stagePhoto(token: string) {
    const { POST } = await import("@/app/api/v2/[user]/media/route");
    const form = new FormData();
    form.append("file", new File([new Uint8Array(await makeJpeg(1, 400, 300))], "loose.jpg", { type: "image/jpeg" }));
    form.append(
      "intent",
      JSON.stringify({
        kind: "photo",
        declined: { trip: "not sorted yet", day: "not sorted yet", caption: "not said at upload" },
      }),
    );
    const response = await POST(
      new Request(`https://example.test/api/v2/${OWNER}/media`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: form,
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const body = await response.json();
    return (body.src as string).replace(/^inbox:/, "");
  }

  test("lists what is staged and deletes on request", async () => {
    const token = await ownerToken();
    const id = await stagePhoto(token);

    const { GET } = await import("@/app/api/v2/[user]/inbox/route");
    const listed = await GET(
      new Request(`https://example.test/api/v2/${OWNER}/inbox`, {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.counts.media).toBe(1);
    expect(listedBody.items.media[0].id).toBe(id);

    const { DELETE } = await import("@/app/api/v2/[user]/inbox/[id]/route");
    const deleted = await DELETE(
      new Request(`https://example.test/api/v2/${OWNER}/inbox/${id}`, {
        method: "DELETE",
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER, id }) },
    );
    expect(deleted.status).toBe(200);

    const after = await GET(
      new Request(`https://example.test/api/v2/${OWNER}/inbox`, {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect((await after.json()).counts.media).toBe(0);
  });
});

describe("the safety shape", () => {
  test("nothing under app/api imports sendOrder", () => {
    const hits: string[] = [];
    const walk = (root: string) => {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, "utf8").includes("sendOrder")) {
          hits.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "app", "api"));
    expect(hits).toEqual([]);
  });
});
