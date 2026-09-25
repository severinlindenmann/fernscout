import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";

/**
 * B1658 — does B1660 actually unblock routing `set_budget`/`set_rate` onto
 * v2's `applyTripPatch`? Verified here rather than assumed.
 *
 * B1660 alone did not: it taught `create_trip` to ask-or-decline four of v2's
 * nine `TRIP_DECLINABLES` (`accent`, `tagline`, `intro`, `rates`) plus `days`
 * for free, leaving `costs`, `plan`, `translations`, `figures` and `buddies`
 * silently unanswered — this test used to name all five as still missing
 * after a create.
 *
 * **B2021 closes four of those five** — the new-trip studio step's own
 * `costsBudget`, `figuresMode` and `company` fields, plus `plan`'s own
 * unconditional decline in `createTrip` (nothing this door takes could ever
 * state a route). `translations` is exempt here too, since this journal
 * keeps one locale (B1667's `exemptSingleLocaleTranslations`, applied by the
 * v2 route this test's own `applyTripPatch` call goes through).
 *
 * **`listed` is the one gap B2021 leaves**, deliberately (ticket: "Not
 * doing: changing the v2 contract") — a public trip's advertising choice has
 * no studio question yet, so a helper-created *public* trip still owes it.
 * That is the one field this test still expects missing.
 */

const OWNER_EMAIL = "traveler9@example.test";
const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

let dir: string;
const params = { params: Promise.resolve({ user: "traveler9" }) };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b1658-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "traveler9", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "traveler9", "config.json"),
    JSON.stringify({
      title: "Traveler9",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { helper: { enabled: true } },
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
  delete process.env.ANTHROPIC_API_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a helper-created trip, fully answered on B2021's fields too, only owes a public trip's `listed`", async () => {
  const { POST: createTripRoute } = await import("@/app/api/helper/[user]/trip/route");
  const created = await createTripRoute(
    new Request("https://t.test/api/helper/traveler9/trip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Japan",
        start: "2027-03-01",
        end: "2027-03-31",
        accent: "none",
        tagline: "none",
        intro: "none",
        rates: "none",
        costsBudget: "none",
        figuresMode: { mode: "journal" },
        company: "solo",
      }),
    }),
    params,
  );
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const { applyTripPatch } = await import("@/app/api/v2/[user]/trips/[trip]/route");
  const journal = getUser("traveler9")!;
  const patchResponse = await applyTripPatch(
    "traveler9",
    id,
    journal,
    new Request(`https://t.test/api/v2/traveler9/trips/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ costs: { budget: { total: 1000 } } }),
    }),
  );
  const body = (await patchResponse.json()) as {
    error?: string;
    details?: { missing?: { field: string }[] };
  };
  expect(patchResponse.status).toBe(422);
  expect(body.error).toBe("incomplete");

  const missingFields = (body.details?.missing ?? []).map((m) => m.field).sort();
  // `costs` is answered by the patch itself. `accent`/`tagline`/`intro`/
  // `rates`/`days` are B1660's own gate; `plan`/`figures`/`buddies` are
  // B2021's. `translations` is exempt — one locale (B1667). `listed` is the
  // one B2021 leaves: a public trip's advertising choice, which this route
  // still never asks.
  expect(missingFields).toEqual(["listed"]);
});
