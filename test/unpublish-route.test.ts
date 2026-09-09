import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, tripWriteScope, verifyCode } from "@/lib/auth";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { POST as writeDay } from "@/app/api/v1/[user]/trips/[trip]/days/route";
import { POST as publishDay } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route";
import { POST as unpublishDay } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/unpublish/route";

/**
 * Taking a day back off the site, over the documented API — B905.
 *
 * `.../publish` has existed since B28. Taking a day down existed only at
 * `POST /api/helper/<user>/day/unpublish` — cookie-only, outside the published
 * contract, added for the browser. So an agent over the network could publish
 * and could not undo it, which is a gate backwards: the **reversible** half of
 * the pair was the half that was missing, and the person most likely to need
 * it is the one whose friend has just asked to come out of a photograph.
 *
 * What is asserted here is that it mirrors publishing rather than merely
 * resembling it — same refusals, same owner rule — and that it is not a
 * delete.
 */

const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";
const COMPANION_EMAIL = "mara@example.test";

let dir: string;

async function tokenFor(email: string, trip?: string): Promise<string> {
  const { code } = await issueCode("alex", email, "agent", trip ? { trip } : undefined);
  const verified = await verifyCode(
    "alex",
    email,
    code,
    "agent",
    trip ? tripWriteScope(trip) : undefined,
  );
  if (!verified.ok) throw new Error(`no token for ${email}`);
  return verified.token;
}

async function write(body: unknown) {
  const response = await writeDay(
    new Request("https://t.test/api/v1/alex/trips/reise/days", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await tokenFor(OWNER_EMAIL)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  return (await response.json()) as { slug?: string };
}

async function publish(slug: string) {
  const response = await publishDay(
    new Request(`https://t.test/api/v1/alex/trips/reise/days/${slug}/publish`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await tokenFor(OWNER_EMAIL)}`,
        "content-type": "application/json",
      },
      body: "{}",
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function unpublish(slug: string, token?: string, trip = "reise") {
  const response = await unpublishDay(
    new Request(`https://t.test/api/v1/alex/trips/${trip}/days/${slug}/unpublish`, {
      method: "POST",
      headers: { authorization: `Bearer ${token ?? (await tokenFor(OWNER_EMAIL))}` },
    }),
    { params: Promise.resolve({ user: "alex", trip, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-unpublish-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "unpublish-route-secret-b905-b905-b905";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
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
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    [
      "---",
      "id: reise",
      'title: "Reise"',
      'start: "2026-09-01"',
      'end: "2026-09-05"',
      "status: current",
      "visibility: public",
      "people:",
      "  - name: Mara",
      `    email: ${COMPANION_EMAIL}`,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
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

async function aPublishedDay() {
  const { slug } = await write({
    date: "2026-09-02",
    title: "Ein Tag",
    content: "Etwas ist passiert.",
    costs: false,
    coordinates: false,
    photos: false,
  });
  if (!slug) throw new Error("the day was not written");
  const up = await publish(slug);
  expect(up.status).toBe(200);
  return slug;
}

describe("a day that is on the site", () => {
  test("comes off, and nothing is deleted", async () => {
    const slug = await aPublishedDay();
    const before = getEntryBySlug(REF, slug, AS_AUTHOR)!;

    const down = await unpublish(slug);
    expect(down.status).toBe(200);
    expect(down.body.status).toBe("draft");

    const after = getEntryBySlug(REF, slug, AS_AUTHOR)!;
    expect(after.draft).toBe(true);
    // The whole of what a takedown is: the day is still there.
    expect(after.title).toBe(before.title);
    expect(after.content).toBe(before.content);
    expect(after.date).toBe(before.date);
  });

  test("and can be put back, which is what makes it not a delete", async () => {
    const slug = await aPublishedDay();
    expect((await unpublish(slug)).status).toBe(200);
    expect((await publish(slug)).status).toBe(200);
    expect(getEntryBySlug(REF, slug, AS_AUTHOR)?.draft).toBeFalsy();
  });

  test("says what happened in words to repeat, including what it cannot undo", async () => {
    const slug = await aPublishedDay();
    const note = String((await unpublish(slug)).body.note);
    expect(note).toContain("Nothing was deleted");
    // The honest limit. Somebody asking for a takedown is usually worried
    // about who saw it, and this is the half that cannot be fixed.
    expect(note).toMatch(/already read it/i);
  });
});

describe("what it refuses", () => {
  test("a day that was never up, rather than a cheerful 200", async () => {
    const { slug } = await write({
      date: "2026-09-03",
      title: "Entwurf",
      content: "Noch nicht.",
      costs: false,
      coordinates: false,
      photos: false,
    });
    const down = await unpublish(slug!);
    expect(down.status).toBe(409);
    expect(down.body.error).toBe("already_draft");
  });

  test("a day that does not exist", async () => {
    expect((await unpublish("kein-tag")).status).toBe(404);
  });

  test("a trip that does not exist", async () => {
    const down = await unpublish("egal", undefined, "keine-reise");
    expect(down.status).toBe(404);
    expect(down.body.error).toBe("unknown_trip");
  });

  test("no token at all", async () => {
    const response = await unpublishDay(
      new Request("https://t.test/api/v1/alex/trips/reise/days/x/unpublish", { method: "POST" }),
      { params: Promise.resolve({ user: "alex", trip: "reise", slug: "x" }) },
    );
    expect(response.status).toBe(401);
  });

  /**
   * The rule publishing sets, mirrored — and it cuts both ways, which is the
   * point. Somebody who came on one trip may write days into it and may
   * neither put them on the site nor take them off: being on the bus is not
   * the same as deciding what the journal says.
   */
  test("a trip-scoped token, which may write days but not take them down", async () => {
    const slug = await aPublishedDay();
    const companion = await tokenFor(COMPANION_EMAIL, "reise");
    const down = await unpublish(slug, companion);
    expect(down.status).toBe(403);
    expect(down.body.error).toBe("out_of_scope");
    expect(String(down.body.message)).toMatch(/cannot|only the journal's owner/i);
    // And it really is still up.
    expect(getEntryBySlug(REF, slug, AS_AUTHOR)?.draft).toBeFalsy();
  });
});
