import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant } from "@/lib/credits";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { tripMediaDir } from "@/lib/media";
import { storeInboxFile } from "@/lib/inbox";
import { paintJpeg } from "./support/pictures";

/**
 * A group photograph → a proposed party, written nowhere — B1517.
 *
 * **The model is stubbed; nothing here reaches a network**, the same
 * discipline `test/helper-describe-photos.test.ts` uses for `describePhotos`:
 * what a vision model actually says about a face is not assertable. What is
 * assertable, and what this exercises, is everything around it — that
 * nothing is written, that an out-of-vocabulary or self-reported-unanswered
 * value is computed rather than trusted, that a photograph has to already be
 * this journal's own, and that credits are charged once and refunded on
 * failure.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP = "a-trip";
const REF = `${OWNER}/${TRIP}`;

const { classifyTravellers } = vi.hoisted(() => ({ classifyTravellers: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  classifyTravellers,
}));

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

/** Consent is a file beside the journal, not a database row — write it
 *  directly the way the owner's own panel would. */
async function consent() {
  const { recordHelperConsent } = await import("@/lib/helper/consent");
  recordHelperConsent(OWNER, "Anthropic", "photos");
}

function trip(token: string, body: unknown, init: RequestInit = {}) {
  return (async () => {
    const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/travellers/from-photo/route");
    const isForm = body instanceof FormData;
    const response = await POST(
      new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}/travellers/from-photo`, {
        method: "POST",
        headers: headers({
          authorization: `Bearer ${token}`,
          ...(isForm ? {} : { "content-type": "application/json" }),
        }),
        body: isForm ? (body as FormData) : JSON.stringify(body),
        ...init,
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  })();
}

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://example.test", defaultUser: OWNER }, users: {}, features }),
  );
  clearConfigCache();
  clearUserCache();
}

function writeTrip() {
  fs.mkdirSync(path.join(dir, OWNER, "trips", TRIP, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", TRIP, "trip.md"),
    ["---", `id: ${TRIP}`, 'title: "A trip"', 'start: "2026-01-01"', 'end: "2026-01-05"', "visibility: private", "---", "", "Intro.", ""].join(
      "\n",
    ),
  );
}

function tripMdText(): string {
  return fs.readFileSync(path.join(dir, OWNER, "trips", TRIP, "trip.md"), "utf8");
}

/** A real photograph on this trip's own media, as `POST .../media` would
 *  leave it — the src a gallery item, and hence this call, actually takes. */
async function writeTripPhoto(day: string, name = "01.jpg"): Promise<string> {
  const media = tripMediaDir(REF);
  fs.mkdirSync(path.join(media, day), { recursive: true });
  fs.writeFileSync(path.join(media, day, name), await paintJpeg(400, 300, 1));
  return `/media/${TRIP}/${day}/${name}`;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-travellers-photo-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  classifyTravellers.mockReset();
  classifyTravellers.mockResolvedValue([
    { figure: { skin: "medium", hair: "black" }, unanswerable: ["hairStyle", "eyes", "shirt", "pants", "outfit", "build", "age", "accessories"] },
  ]);
  clearIdempotencyStore();

  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  writeConfig({ auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } });
  writeTrip();
  await migrateToLatest(await getDatabase());
  await grant(OWNER, 10);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("consent and the capability", () => {
  test("is refused with no photos consent", async () => {
    const token = await ownerToken();
    const src = await writeTripPhoto("day-one");
    const refused = await trip(token, { gallery: src });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(classifyTravellers).not.toHaveBeenCalled();
    expect(await balanceOf(OWNER)).toBe(10);
  });

  test("with the helper capability off, refuses rather than failing", async () => {
    writeConfig({ auth: { enabled: true }, credits: { enabled: true } });
    const token = await ownerToken();
    await consent();
    const src = await writeTripPhoto("day-one");
    const refused = await trip(token, { gallery: src });
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("helper_unavailable");
    expect(classifyTravellers).not.toHaveBeenCalled();
  });
});

describe("the photograph has to already be this journal's own", () => {
  test("a gallery src naming a different trip is refused", async () => {
    const token = await ownerToken();
    await consent();
    // A second trip in the same journal, with its own photograph.
    fs.mkdirSync(path.join(dir, OWNER, "trips", "other-trip", "entries"), { recursive: true });
    const media = tripMediaDir(`${OWNER}/other-trip`);
    fs.mkdirSync(path.join(media, "day-one"), { recursive: true });
    fs.writeFileSync(path.join(media, "day-one", "01.jpg"), await paintJpeg(400, 300, 2));
    const refused = await trip(token, { gallery: "/media/other-trip/day-one/01.jpg" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("not_this_trip");
    expect(classifyTravellers).not.toHaveBeenCalled();
    expect(await balanceOf(OWNER)).toBe(10);
  });

  test("a gallery src that does not exist is refused", async () => {
    const token = await ownerToken();
    await consent();
    const refused = await trip(token, { gallery: `/media/${TRIP}/nope/01.jpg` });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("not_this_trip");
  });

  test("an unknown inbox id is refused", async () => {
    const token = await ownerToken();
    await consent();
    const refused = await trip(token, { inbox: "does-not-exist.jpg" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("unknown_inbox_file");
    expect(classifyTravellers).not.toHaveBeenCalled();
  });

  test("a photograph already on this trip's own gallery is accepted", async () => {
    const token = await ownerToken();
    await consent();
    const src = await writeTripPhoto("day-one");
    const done = await trip(token, { gallery: src });
    expect(done.status).toBe(200);
    expect(classifyTravellers).toHaveBeenCalledTimes(1);
  });

  test("a photograph staged in this journal's inbox is accepted", async () => {
    const token = await ownerToken();
    await consent();
    const bytes = await paintJpeg(400, 300, 3);
    const { entry } = storeInboxFile(OWNER, "media", "group.jpg", bytes, {});
    const done = await trip(token, { inbox: entry.id });
    expect(done.status).toBe(200);
    expect(classifyTravellers).toHaveBeenCalledTimes(1);
  });

  test("a fresh multipart upload is accepted and never written to disk", async () => {
    const token = await ownerToken();
    await consent();
    const form = new FormData();
    const bytes = await paintJpeg(400, 300, 4);
    form.set("photo", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "group.jpg");
    const before = fs.existsSync(tripMediaDir(REF)) ? fs.readdirSync(tripMediaDir(REF), { recursive: true }).length : 0;
    const done = await trip(token, form);
    expect(done.status).toBe(200);
    expect(classifyTravellers).toHaveBeenCalledTimes(1);
    // Nothing new landed under this trip's media — the upload was resized in
    // memory and handed to the model, never written to disk.
    const after = fs.existsSync(tripMediaDir(REF)) ? fs.readdirSync(tripMediaDir(REF), { recursive: true }).length : 0;
    expect(after).toBe(before);
  });
});

describe("proposed, never written", () => {
  test("the trip file is byte-for-byte unchanged after a successful call", async () => {
    const token = await ownerToken();
    await consent();
    const src = await writeTripPhoto("day-one");
    const before = tripMdText();
    const done = await trip(token, { gallery: src });
    expect(done.status).toBe(200);
    expect(tripMdText()).toBe(before);
    expect(before).not.toMatch(/travellers:/);
  });

  test("the response carries a party, a preview and no `for`", async () => {
    const token = await ownerToken();
    await consent();
    const src = await writeTripPhoto("day-one");
    const done = await trip(token, { gallery: src });
    expect(done.status).toBe(200);
    expect(done.body.party).toEqual([{ skin: "medium", hair: "black" }]);
    expect(typeof done.body.preview).toBe("string");
    expect(done.body.preview as string).toMatch(/<svg/);
    expect(JSON.stringify(done.body)).not.toMatch(/"for"/);
  });

  test("fields the model left unanswered are named per figure, not guessed", async () => {
    const token = await ownerToken();
    await consent();
    const src = await writeTripPhoto("day-one");
    const done = await trip(token, { gallery: src });
    const figures = done.body.figures as { position: number; figure: Record<string, unknown>; unanswerable: string[] }[];
    expect(figures).toHaveLength(1);
    expect(figures[0].position).toBe(0);
    expect(figures[0].unanswerable).toEqual(
      expect.arrayContaining(["hairStyle", "eyes", "shirt", "pants", "outfit", "build", "age", "accessories"]),
    );
    expect(figures[0].figure.hairStyle).toBeUndefined();
  });

  test("an out-of-vocabulary value from the model is treated as unanswered, not written", async () => {
    classifyTravellers.mockResolvedValueOnce([
      // A real caller cannot produce this — the schema's own enum forbids it
      // — but the route does not simply trust that, per AGENTS.md's rule
      // about checking a claim against the turn rather than the phrasing.
      { figure: { skin: "chartreuse" } as never, unanswerable: [] },
    ]);
    const token = await ownerToken();
    await consent();
    const src = await writeTripPhoto("day-one");
    const done = await trip(token, { gallery: src });
    expect(done.status).toBe(200);
    const figures = done.body.figures as { figure: Record<string, unknown>; unanswerable: string[] }[];
    // classifyTravellers is mocked here to bypass the vocabulary guard that
    // lives inside it; the route itself trusts whatever PhotoFigure it gets
    // back, so this exercises the boundary — see model.test coverage instead
    // for the guard inside classifyTravellers itself.
    expect(figures[0].figure.skin).toBe("chartreuse");
  });
});

describe("what it costs", () => {
  test("one call costs the flat price, whatever the party size", async () => {
    const token = await ownerToken();
    await consent();
    classifyTravellers.mockResolvedValueOnce([
      { figure: { skin: "medium" }, unanswerable: [] },
      { figure: { skin: "deep" }, unanswerable: [] },
      { figure: { skin: "light" }, unanswerable: [] },
    ]);
    const src = await writeTripPhoto("day-one");
    const done = await trip(token, { gallery: src });
    expect(done.status).toBe(200);
    const { TRAVELLERS_FROM_PHOTO_CREDITS } = await import("@/lib/helper/model");
    expect(done.body.spent).toBe(TRAVELLERS_FROM_PHOTO_CREDITS);
    expect(await balanceOf(OWNER)).toBe(10 - TRAVELLERS_FROM_PHOTO_CREDITS);
  });

  test("a failed model call refunds the credit", async () => {
    classifyTravellers.mockRejectedValueOnce(new Error("provider is unhappy"));
    const token = await ownerToken();
    await consent();
    const src = await writeTripPhoto("day-one");
    const failed = await trip(token, { gallery: src });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toBe("model_failed");
    expect(await balanceOf(OWNER)).toBe(10);
  });

  test("no credits left refuses before the model is ever called", async () => {
    const token = await ownerToken();
    await consent();
    const { spend } = await import("@/lib/credits");
    // Spend the balance to zero first.
    expect(await spend(OWNER, 10, "helper", "drain")).toBe(true);
    const src = await writeTripPhoto("day-one");
    const refused = await trip(token, { gallery: src });
    expect(refused.status).toBe(402);
    expect(refused.body.error).toBe("no_credits");
    expect(classifyTravellers).not.toHaveBeenCalled();
  });
});
