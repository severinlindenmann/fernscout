import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { forgetEntries } from "@/lib/entries";

/**
 * B1118 — a published day is not deleted on a self-served round trip.
 *
 * B101 found `DELETE .../days` would remove a *published* day behind the
 * `agentConfirm` handshake, which is the same agent asking for the code and
 * spending it. B224's doctrine is that destroying content people have already
 * read needs a step no bearer token can complete alone. There is no mailbox on
 * this route, so the fix refuses a published day outright and points at
 * `unpublish` (reversible) — a draft still deletes the normal way.
 *
 * The gate itself (`@/lib/api/auth`) is mocked to a passing owner, because the
 * thing under test is what the handler does *after* auth, not auth.
 */

vi.mock("@/lib/api/auth", () => ({
  authenticate: vi.fn(async () => ({ ok: true, session: { username: OWNER, scope: ["write:content"], email: "alex@example.test" } })),
  ownsUser: vi.fn(() => true),
  mayWriteTrip: vi.fn(async () => ({ ok: true })),
  outOfScope: vi.fn(() => Response.json({ error: "out_of_scope" }, { status: 404 })),
  refuseWrite: vi.fn(() => Response.json({ error: "refused" }, { status: 403 })),
  errorResponse: vi.fn((a: { status: number; error: string }) => Response.json({ error: a.error }, { status: a.status })),
}));

const OWNER = "alex";
const TRIP = "alps";
let dir: string;

const entriesDir = () => path.join(dir, OWNER, "trips", TRIP, "entries");

function entry(slug: string, draft: boolean) {
  fs.writeFileSync(
    path.join(entriesDir(), `2026-09-02-${slug}.md`),
    [
      "---",
      `title: "${slug}"`,
      'date: "2026-09-02"',
      'location: "Somewhere"',
      'country: "Nowhere"',
      ...(draft ? ['status: "draft"'] : []),
      "---",
      "",
      "Something happened.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b1118-"));
  process.env.CONTENT_DIR = dir;
  process.env.SESSION_SECRET = "b1118-test-secret-b1118-test-secret";
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
      owner: { name: "Alex B", nickname: "Alex", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: {},
    }),
  );
  fs.mkdirSync(entriesDir(), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", TRIP, "trip.md"),
    ['---', `id: "${TRIP}"`, `title: "${TRIP}"`, 'start: "2026-09-01"', 'end: "2026-09-10"', 'visibility: "public"', "---", "", "Intro.", ""].join("\n"),
  );
  clearUserCache();
  forgetEntries(`${OWNER}/${TRIP}`);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
  delete process.env.SESSION_SECRET;
  vi.clearAllMocks();
});

const params = { params: Promise.resolve({ user: OWNER, trip: TRIP }) } as never;
const del = (body: unknown) =>
  new Request(`https://t.test/api/v1/${OWNER}/trips/${TRIP}/days`, {
    method: "DELETE",
    headers: { "content-type": "application/json", authorization: "Bearer x" },
    body: JSON.stringify(body),
  });

describe("deleting a published day", () => {
  test("is refused with published_day_not_deletable, no code can satisfy it, and the file survives", async () => {
    entry("live-day", false); // published
    forgetEntries(`${OWNER}/${TRIP}`);
    const { DELETE } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");

    const first = await DELETE(del({ slug: "live-day" }), params);
    expect(first.status).toBe(409);
    const body = await first.json();
    expect(body.error).toBe("published_day_not_deletable");
    expect(body.unpublish).toContain("/unpublish");
    // No confirm code is offered — there is nothing to repeat.
    expect(body.confirm).toBeUndefined();

    // The entry file is still there.
    expect(fs.existsSync(path.join(entriesDir(), "2026-09-02-live-day.md"))).toBe(true);
  });
});

describe("deleting a draft day", () => {
  test("still works through the self-served handshake, and removes the file", async () => {
    entry("scrap", true); // draft
    forgetEntries(`${OWNER}/${TRIP}`);
    const { DELETE } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");

    const first = await DELETE(del({ slug: "scrap" }), params);
    expect(first.status).toBe(409);
    const asked = await first.json();
    expect(typeof asked.confirm).toBe("string");
    // A confirmation prompt, not the published-day refusal — the code is what
    // makes it a self-served round trip, which is fine for a draft nobody read.
    expect(asked.error).toBe("confirmation_required");
    expect(asked.error).not.toBe("published_day_not_deletable");

    const second = await DELETE(del({ slug: "scrap", confirm: asked.confirm }), params);
    expect(second.status).toBe(200);
    const done = await second.json();
    expect(done.deleted).toBe(true);
    expect(fs.existsSync(path.join(entriesDir(), "2026-09-02-scrap.md"))).toBe(false);
  });
});
