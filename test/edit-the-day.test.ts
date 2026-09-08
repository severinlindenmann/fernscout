import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B980 — the owner's own door onto `editEntry`, from a browser.
 *
 * What is worth pinning here is the gate and the narrowing, not the writing:
 * `editEntry` and `validateEntryEdit` are covered where they live, and this
 * route is deliberately a thin owner-only wrapper over both. So: a bearer
 * token is refused before anything else happens, somebody who is not the
 * owner is refused, a field the panel cannot draw is refused rather than
 * quietly written, and a correction that is allowed actually lands on disk.
 *
 * The last one matters most. This route exists because a person standing on
 * their own day could not fix a word in it, and a route that answered `200`
 * without writing would be the same failure wearing a success.
 */

const OWNER = "alex";
const TRIP = "edit-trip";
const SLUG = "a-day";

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

const entryFile = () =>
  path.join(dir, OWNER, "trips", TRIP, "entries", `2026-09-02-${SLUG}.md`);

function writeJournal() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  clearConfigCache();

  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Notebook",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: "alex@example.test" },
      startLocation: "Zurich",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );

  const root = path.join(dir, OWNER, "trips", TRIP);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${TRIP}"`,
      `title: "${TRIP}"`,
      'start: "2026-09-01"',
      'end: "2026-09-10"',
      'status: "current"',
      'visibility: "public"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    entryFile(),
    [
      "---",
      'title: "A day"',
      'date: "2026-09-02"',
      'location: "Somewhere"',
      'country: "Nowhere"',
      "---",
      "",
      "Something happened.",
      "",
    ].join("\n"),
  );
}

async function route() {
  return import("@/app/[user]/trips/[trip]/day/[slug]/edit/route");
}

async function photoRoute() {
  return import("@/app/[user]/trips/[trip]/day/[slug]/photos/route");
}

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://t.test/${OWNER}/trips/${TRIP}/day/${SLUG}/edit`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: SLUG }) };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-edit-day-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  writeJournal();
  clearUserCache();

  const session = await import("@/lib/contacts/session");
  isOwnerMock = vi.mocked(session.isOwner);
  isOwnerMock.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the owner's own correction door", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await route();
    const response = await PATCH(req({ title: "New" }, { authorization: "Bearer x" }), params);
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('title: "A day"');
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { PATCH } = await route();
    const response = await PATCH(req({ title: "New" }), params);
    expect(response.status).toBe(403);
    expect(fs.readFileSync(entryFile(), "utf8")).toContain('title: "A day"');
  });

  // A day moves on and off the site through its own endpoint — B28 — and this
  // route must not become a second way to do it by accident.
  test("a field the panel cannot draw is refused rather than written", async () => {
    const { PATCH } = await route();
    for (const body of [{ status: "published" }, { photos: false }]) {
      const response = await PATCH(req(body), params);
      expect(response.status).toBe(400);
    }
    expect(fs.readFileSync(entryFile(), "utf8")).toContain("Something happened.");
  });

  // Round 2's door. Same gate, and it must be the same gate — a picture is
  // the half of a day a person is least able to take back.
  test("the photographs door refuses an agent and a stranger too", async () => {
    const { POST, DELETE } = await photoRoute();
    isOwnerMock.mockClear();
    const withToken = new Request(`https://t.test/x/photos`, {
      method: "DELETE",
      headers: { authorization: "Bearer x", "content-type": "application/json" },
      body: JSON.stringify({ src: ["/a.jpg"] }),
    });
    expect((await DELETE(withToken, params)).status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();

    isOwnerMock.mockResolvedValue(false);
    const asStranger = new Request(`https://t.test/x/photos`, { method: "POST", body: new FormData() });
    expect((await POST(asStranger, params)).status).toBe(403);
  });

  test("a correction lands on disk", async () => {
    const { PATCH } = await route();
    const response = await PATCH(req({ title: "Arrival", content: "It rained." }), params);
    expect(response.status).toBe(200);
    const written = fs.readFileSync(entryFile(), "utf8");
    expect(written).toContain('title: "Arrival"');
    expect(written).toContain("It rained.");
    expect(written).not.toContain("Something happened.");
  });
});
