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
 * It does not. B1660 taught `create_trip` to ask-or-decline four of v2's nine
 * `TRIP_DECLINABLES` (`accent`, `tagline`, `intro`, `rates`) plus `days` for
 * free (a brand new trip never has one yet). `costs`, `plan`, `translations`
 * and `figures` have no helper tool that can answer them at create time, and
 * `listed`/`buddies` are conditional questions (public / multi-person) this
 * trip never triggers either. So a helper-created trip still carries five
 * silently-unanswered questions, and `applyTripPatch` revalidates the WHOLE
 * document (`tripCreate.safeParse(merged)`) on every patch — meaning a
 * `set_budget`/`set_rate`-shaped patch through v2 would still 422 `incomplete`
 * naming fields nobody was ever asked about, exactly the "a guard that fires
 * on an honest turn is a bug" case AGENTS.md and B1650 both call out.
 *
 * `set_budget`/`set_rate` therefore stay on `patchCosts`/`patchTripRates` —
 * B1658's own decision (c), status quo — until the remaining declinables
 * (a dedicated budget-asking flow, a plan tool, a figures tool, journal-aware
 * translations) are built, or v2 gains an incremental write mode (decision b).
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

test("a helper-created trip, fully answered on B1660's four fields, still 422s a v2 costs patch on the rest", async () => {
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
  // `costs` itself is answered by the patch. `accent`/`tagline`/`intro`/
  // `rates`/`days` are answered by B1660's create-time gate. Everything else
  // v2's `tripCreate` schema asks a trip — `plan`, `figures` (no helper tool
  // writes either) — plus this trip's own `listed` (public, never asked) and
  // `buddies` (solo, never asked) — is still silently missing, so the merged
  // document still refuses. NOT `translations` — this journal has one locale
  // (`locales: ["en"]` above), so that question is exempt (B1667).
  expect(missingFields).toEqual(["buddies", "figures", "listed", "plan"]);
});
