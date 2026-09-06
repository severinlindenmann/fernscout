import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip } from "@/lib/trips";
import { POST as writeDay } from "@/app/api/v1/[user]/trips/[trip]/days/route";
import { POST as publishDay } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route";
import { PATCH as patchTracks } from "@/app/api/v1/[user]/trips/[trip]/tracks/route";

/**
 * B531 — the completeness contract, and `docs/plans/W40-what-a-day-owes.md`.
 *
 * An agent moved fourteen days onto a hosted instance and left the money on
 * its own laptop. Every call answered 200. The claim under test is that this
 * is no longer possible **and** that the way out is never "invent a value":
 * every refusal offers the decline, and the decline is written into the day
 * so that "nothing was spent" stays different from "nobody asked".
 */

let dir: string;
const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";
const DAY = { date: "2026-09-02", title: "Ein Tag", content: "Etwas ist passiert." };

function writeTrip(front: string[] = []) {
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
      ...front,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

async function token(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  return verified.token;
}

async function post(body: unknown) {
  const response = await writeDay(
    new Request("https://t.test/api/v1/alex/trips/reise/days", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function publish(slug: string, body: unknown = {}) {
  const response = await publishDay(
    new Request(`https://t.test/api/v1/alex/trips/reise/days/${slug}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-contract-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "day-contract-test-secret-what-a-day-owes";
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

describe("a trip tracks everything unless it says otherwise", () => {
  test("a day that says nothing about money or place is refused, and told both ways out", async () => {
    const { status, body } = await post(DAY);
    expect(status).toBe(422);
    expect(body.error).toBe("incomplete_day");

    const missing = body.missing as { field: string; send: string; decline: string }[];
    expect(missing.map((m) => m.field)).toEqual(["costs", "coordinates"]);
    // The half that matters: the decline is offered as plainly as the value.
    for (const row of missing) {
      expect(row.send.length).toBeGreaterThan(0);
      expect(row.decline).toMatch(/false/);
    }
    // And the message says to ask rather than to supply something plausible.
    expect(String(body.message)).toMatch(/Ask the person/);
    expect(String(body.message)).not.toMatch(/estimate|guess a|approximate/i);
  });

  test("nothing is written when it is refused", async () => {
    await post(DAY);
    expect(fs.readdirSync(path.join(dir, "alex", "trips", "reise", "entries"))).toEqual([]);
  });

  test("sending the things it asks for writes the day", async () => {
    const { status } = await post({
      ...DAY,
      lat: 47.55,
      lng: 7.59,
      costs: [{ label: "Kaffee", amount: 4.5, currency: "CHF" }],
    });
    expect(status).toBe(201);
    expect(getEntryBySlug(REF, "ein-tag", { includeDrafts: true })!.costs).toHaveLength(1);
  });

  test("declining writes the day, and writes the decline into it", async () => {
    const { status } = await post({ ...DAY, costs: false, coordinates: false });
    expect(status).toBe(201);

    const entry = getEntryBySlug(REF, "ein-tag", { includeDrafts: true })!;
    expect(entry.without).toEqual(["costs", "coordinates"]);
    // In the file, because the distinction it makes — "nothing was spent"
    // against "nobody asked" — is for whoever reads the day in a year.
    const file = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-09-02-ein-tag.md"),
      "utf8",
    );
    expect(file).toContain("without: [costs, coordinates]");
  });

  test("a trip that keeps neither asks for neither", async () => {
    writeTrip(["tracks:", "  costs: false", "  coordinates: false"]);
    expect(getTrip(REF)!.tracks).toEqual({ costs: false, coordinates: false, photos: true });
    expect((await post(DAY)).status).toBe(201);
  });

  test("a decline is only the word itself — a typo is refused rather than recorded", async () => {
    const { status, body } = await post({ ...DAY, coordinates: "no", costs: false });
    expect(status).toBe(400);
    expect(JSON.stringify(body.problems)).toMatch(/coordinates/);
  });
});

describe("photographs are the publish gate", () => {
  test("a day with no pictures is not published, and the day stays a draft", async () => {
    await post({ ...DAY, costs: false, coordinates: false });
    const { status, body } = await publish("ein-tag");
    expect(status).toBe(422);
    expect((body.missing as { field: string }[]).map((m) => m.field)).toEqual(["photos"]);
    expect(getEntryBySlug(REF, "ein-tag", { includeDrafts: true })!.draft).toBe(true);
  });

  test("saying there are none publishes it, and the day records that", async () => {
    await post({ ...DAY, costs: false, coordinates: false });
    expect((await publish("ein-tag", { photos: false })).status).toBe(200);

    const entry = getEntryBySlug(REF, "ein-tag")!;
    expect(entry.draft).toBeUndefined();
    expect(entry.without).toContain("photos");
  });

  test("the gate re-runs the whole contract, so a day written before the trip tracked something is caught", async () => {
    writeTrip(["tracks:", "  costs: false", "  coordinates: false", "  photos: false"]);
    await post(DAY);

    // The owner turns the money back on half way through the trip.
    writeTrip();
    clearConfigCache();
    const { status, body } = await publish("ein-tag");
    expect(status).toBe(422);
    expect((body.missing as { field: string }[]).map((m) => m.field)).toEqual([
      "costs",
      "coordinates",
      "photos",
    ]);
  });
});

describe("what a trip keeps is the owner's to change", () => {
  test("turning costs off stops the asking, and says what it did not do", async () => {
    const response = await patchTracks(
      new Request("https://t.test/api/v1/alex/trips/reise/tracks", {
        method: "PATCH",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ tracks: { costs: false } }),
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise" }) },
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect((body.tracks as Record<string, boolean>).costs).toBe(false);
    expect((body.tracks as Record<string, boolean>).coordinates).toBe(true);
    expect(String(body.note)).toMatch(/Nothing already written changes/);

    // Only the row named changed, so the day is still asked where it was.
    const after = await post(DAY);
    expect(after.status).toBe(422);
    expect((after.body.missing as { field: string }[]).map((m) => m.field)).toEqual([
      "coordinates",
    ]);
  });

  test("a misspelled row is refused rather than silently ignored", async () => {
    const response = await patchTracks(
      new Request("https://t.test/api/v1/alex/trips/reise/tracks", {
        method: "PATCH",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ tracks: { cost: false } }),
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise" }) },
    );
    expect(response.status).toBe(400);
    // The singular is the obvious typo, and a 201 for it would mean every day
    // being refused for its costs with nothing to explain why.
    expect(String(((await response.json()) as Record<string, unknown>).message)).toMatch(/cost/);
    expect(getTrip(REF)!.tracks.costs).toBe(true);
  });
});
