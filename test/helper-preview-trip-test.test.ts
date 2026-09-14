import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createTrip } from "@/lib/tripWrite";

/**
 * B1426 — the helper room's preview pane renders `DayCard` with no
 * `TripProvider`, so `trip?.trip.test` can never be true there even when the
 * trip a day belongs to is itself marked `test: true`. `previewOf` (and this
 * route, which is the pane's only door onto a day) must carry that flag
 * along explicitly so the preview shows the same test banner a real reader
 * would see.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { GET, PATCH, POST } = await import("@/app/api/helper/[user]/day/route");

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

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-preview-test-flag-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-preview-test-flag-secret";
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

  const created = createTrip("alex", {
    id: "test-trip",
    title: "A rehearsal trip",
    start: "2026-05-01",
    end: "2026-05-31",
    test: true,
  });
  if (!created.ok) throw new Error(`trip fixture failed: ${created.message}`);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the preview pane's own read of a test trip", () => {
  test("carries the trip's test flag, not just the entry's own", async () => {
    const made = await read(
      await POST(
        json("POST", {
          trip: "test-trip",
          date: "2026-05-04",
          answers: {
            costs: "none",
            coordinates: "unknown",
            time: "none",
            transportMode: "none",
            tags: "none",
            visibility: "none",
          },
        }),
        params,
      ),
    );
    expect(made.status).toBe(201);
    const slug = String(made.body.slug);

    // Give it real words so the day is worth previewing at all — the day's
    // own `test` field is left unset, so the only thing that could say this
    // is a test is the trip. A real title renames the day off its
    // date-only slug (B1276), so the later read uses the new address.
    const written = await read(
      await PATCH(
        json("PATCH", { trip: "test-trip", slug, title: "A rehearsal day", content: "Nothing happened." }),
        params,
      ),
    );
    const renamed = String((written.body.draft as Record<string, unknown>).slug);

    const state = await read(
      await GET(new Request(`https://t.test/api/helper/alex/day?trip=test-trip&slug=${renamed}`), params),
    );
    expect(state.status).toBe(200);
    expect(state.body.preview).toMatchObject({ tripTest: true });
  });
});
