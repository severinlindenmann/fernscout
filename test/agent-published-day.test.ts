import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";
import { AS_AUTHOR, getDays, getEntryBySlug } from "@/lib/entries";
import { gapsForWizard } from "@/lib/helper/server";

/**
 * The second visit — B816, B818, B819.
 *
 * Once a day was published the browser went read-only for the person whose
 * journal it is: a typo, a forgotten photograph and a friend asking to come
 * out of a picture all needed an agent or an API token. What is asserted here
 * is the half a screenshot cannot show — that the wizard's own door can now
 * load a published day, correct it **without publishing anything by
 * accident**, and take it off the site in a way that is undone by publishing
 * it again.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { GET, PATCH, POST } = await import("@/app/api/helper/[user]/day/route");
const { POST: publishRoute } = await import("@/app/api/helper/[user]/day/publish/route");
const { POST: unpublishRoute } = await import("@/app/api/helper/[user]/day/unpublish/route");

let dir: string;

const params = { params: Promise.resolve({ user: "alex" }) };

function json(method: string, body: unknown) {
  return new Request("https://t.test/api/helper/alex/day", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A written, published day, and its slug. */
async function publishedDay(date: string): Promise<string> {
  const made = await read(
    await POST(
      json("POST", { trip: "a-trip", date, answers: { costs: "none", coordinates: "unknown" } }),
      params,
    ),
  );
  const dateSlug = String(made.body.slug);
  // B1276 — the title given here renames the day off its date-only slug, so
  // everything from here on uses the address the wizard would actually read
  // back, not the one the day was created under. Titled by date, so two
  // calls in the same trip never collide on the same slug.
  const written = await read(
    await PATCH(
      json("PATCH", { trip: "a-trip", slug: dateSlug, title: `A title, ${date}`, content: "What happened." }),
      params,
    ),
  );
  const slug = String((written.body.draft as Record<string, unknown>).slug);
  await PATCH(json("PATCH", { trip: "a-trip", slug, answers: { photos: "unknown" } }), params);
  const live = await read(await publishRoute(json("POST", { trip: "a-trip", slug }), params));
  expect(live.status).toBe(200);
  return slug;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-published-day-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "agent-published-day-secret-b816";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
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
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  await createTripRoute(
    new Request("https://t.test/api/v1/alex/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${verified.token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "a-trip", title: "A trip", start: "2026-05-01", end: "2026-05-08" }),
    }),
    params,
  );
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("correcting a day that is already on the site", () => {
  test("the wizard can load it, and it says it is published", async () => {
    const slug = await publishedDay("2026-05-02");

    const loaded = await read(
      await GET(new Request(`https://t.test/api/helper/alex/day?trip=a-trip&slug=${slug}`), params),
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body.draft).toMatchObject({ slug, written: true, published: true });
  });

  test("saving a correction changes the words and not the published state", async () => {
    const slug = await publishedDay("2026-05-03");

    const fixed = await read(
      await PATCH(
        json("PATCH", { trip: "a-trip", slug, title: "Anna", content: "Her name is Anna." }),
        params,
      ),
    );
    expect(fixed.status).toBe(200);
    expect(fixed.body.draft).toMatchObject({ title: "Anna", published: true });

    // The file itself, not the report about it: nothing put the day back into
    // a draft, and nothing published a second time.
    const entry = getEntryBySlug("alex/a-trip", slug, AS_AUTHOR);
    expect(entry?.draft).toBeUndefined();
    expect(entry?.content).toContain("Her name is Anna.");
  });
});

describe("taking a day off the site", () => {
  test("it goes back to being a draft and leaves the reading paths", async () => {
    const slug = await publishedDay("2026-05-04");
    expect(getDays("alex/a-trip").some((day) => day.entries.some((e) => e.slug === slug))).toBe(true);

    const down = await read(await unpublishRoute(json("POST", { trip: "a-trip", slug }), params));
    expect(down.status).toBe(200);
    expect(down.body.draft).toMatchObject({ slug });
    expect(down.body.draft).not.toHaveProperty("published");

    // Gone from what a reader is given, and still there for its author.
    expect(getDays("alex/a-trip").some((day) => day.entries.some((e) => e.slug === slug))).toBe(false);
    expect(getEntryBySlug("alex/a-trip", slug, AS_AUTHOR)?.draft).toBe(true);

    // And it is a takedown rather than a delete: the day is still on disk,
    // with its words, and publishing it again is the undo.
    const back = await read(await publishRoute(json("POST", { trip: "a-trip", slug }), params));
    expect(back.status).toBe(200);
    expect(getDays("alex/a-trip").some((day) => day.entries.some((e) => e.slug === slug))).toBe(true);
  });

  test("a day that is already a draft is refused rather than cheerfully taken down twice", async () => {
    const made = await read(
      await POST(
        json("POST", {
          trip: "a-trip",
          date: "2026-05-05",
          answers: { costs: "none", coordinates: "unknown" },
        }),
        params,
      ),
    );
    const refused = await read(
      await unpublishRoute(json("POST", { trip: "a-trip", slug: String(made.body.slug) }), params),
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("already_draft");
  });

  test("somebody else's cookie cannot take a day down", async () => {
    const slug = await publishedDay("2026-05-06");
    resolveAccess.mockResolvedValue({ email: "someone@example.test" });
    const refused = await read(await unpublishRoute(json("POST", { trip: "a-trip", slug }), params));
    expect(refused.status).toBe(404);
    expect(getEntryBySlug("alex/a-trip", slug, AS_AUTHOR)?.draft).toBeUndefined();
  });
});

describe("the days of a finished trip nobody wrote — B819", () => {
  test("the gap is the trip's own dates minus the days that exist", async () => {
    await publishedDay("2026-05-01");
    await publishedDay("2026-05-02");

    const gap = gapsForWizard("alex", "2026-06-01");
    expect(gap).toMatchObject({ trip: "a-trip", total: 8 });
    expect(gap?.missing).toEqual([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
    ]);
  });

  test("a trip still running, and one nobody has written a word of, say nothing", async () => {
    // Nothing written at all: not a gap, a trip somebody has not started.
    expect(gapsForWizard("alex", "2026-06-01")).toBeNull();

    await publishedDay("2026-05-01");
    // Still running on this date, so the missing days have not happened yet.
    expect(gapsForWizard("alex", "2026-05-04")).toBeNull();
  });
});
