import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";

/**
 * The four trip settings a conversation could read (`who_can_read`,
 * `trip_costs`, `.../tracks GET`) but never change: `edit_trip`,
 * `set_visibility`, `trip_people` and `trip_tracks`.
 *
 * Same shape as `test/helper-publish-press.test.ts`: propose through
 * `runTool`, press exactly what the proposal's own `arguments` and `fields`
 * carry, and drive each route handler directly rather than over HTTP.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { PATCH: editTrip } = await import("@/app/api/helper/[user]/trip/route");
const { PATCH: setVisibility } = await import("@/app/api/helper/[user]/trip/visibility/route");
const { PATCH: tripPeople } = await import("@/app/api/helper/[user]/trip/people/route");
const { PATCH: tripTracks } = await import("@/app/api/helper/[user]/trip/tracks/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-edit-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-trip-edit-secret-cap-trips";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

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
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    [
      "---",
      "id: reise",
      "title: Die Reise",
      'start: "2026-05-01"',
      'end: "2026-05-10"',
      "visibility: private",
      "---",
      "",
      "Intro.",
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
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** What the browser posts when somebody presses — `proposal.arguments`
 *  merged with the fields as they stand on the card. */
function pressed(proposal: {
  arguments: Record<string, string>;
  fields: { name: string; value: string }[];
}) {
  return {
    ...proposal.arguments,
    ...Object.fromEntries(proposal.fields.map((field) => [field.name, field.value])),
  };
}

async function propose(tool: string, args: Record<string, string> = {}) {
  const ran = await runTool("alex", tool, { trip: "reise", ...args }, say, "2026-09-07");
  if (!ran.proposal) throw new Error(`${tool} proposed nothing`);
  return ran.proposal;
}

function patch(
  route: (request: Request, context: typeof params) => Promise<Response>,
  url: string,
  body: unknown,
) {
  return route(
    new Request(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

async function pressRows() {
  const { db } = (await getDatabase())!;
  return db.selectFrom("helper_sessions").selectAll().where("kind", "=", "press").execute();
}

function tripFile() {
  return fs.readFileSync(path.join(dir, "alex", "trips", "reise", "trip.md"), "utf8");
}

describe("edit_trip", () => {
  test("a new title and new dates, pressed exactly as proposed", async () => {
    const proposal = await propose("edit_trip", {
      title: "Neue Reise",
      start: "2026-05-02",
      end: "2026-05-12",
    });
    const res = await patch(editTrip, "https://t.test/api/helper/alex/trip", pressed(proposal));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(tripFile()).toContain("Neue Reise");
    expect(tripFile()).toContain("2026-05-02");
  });
});

describe("set_visibility", () => {
  test("a closed list of exactly the three values", async () => {
    const proposal = await propose("set_visibility", { visibility: "guest" });
    const field = proposal.fields.find((one) => one.name === "visibility");
    expect(field?.options?.map((one) => one.value)).toEqual(["public", "guest", "private"]);
  });

  test("pressed, it changes the trip", async () => {
    const proposal = await propose("set_visibility", { visibility: "guest" });
    const res = await patch(
      setVisibility,
      "https://t.test/api/helper/alex/trip/visibility",
      pressed(proposal),
    );
    expect(res.status).toBe(200);
    expect(tripFile()).toContain("visibility: guest");
  });
});

describe("trip_people", () => {
  test("adding somebody writes them into the byline", async () => {
    const proposal = await propose("trip_people", { person: "Mara", email: "mara@example.test" });
    const res = await patch(tripPeople, "https://t.test/api/helper/alex/trip/people", pressed(proposal));
    expect(res.status).toBe(200);
    expect(tripFile()).toContain("mara@example.test");
    expect(tripFile()).toContain("Mara");
  });

  test("with no email, nothing is proposed and there is no button", async () => {
    const ran = await runTool("alex", "trip_people", { trip: "reise", person: "Mara" }, say, "2026-09-07");
    expect(ran.proposal).toBeUndefined();
  });
});

describe("trip_tracks", () => {
  test("turning a row off, pressed exactly as proposed", async () => {
    const proposal = await propose("trip_tracks", { costs: "off" });
    const costs = proposal.fields.find((one) => one.name === "costs");
    expect(costs?.value).toBe("false");
    const res = await patch(tripTracks, "https://t.test/api/helper/alex/trip/tracks", pressed(proposal));
    expect(res.status).toBe(200);
    expect(tripFile()).toContain("costs: false");
  });
});

/**
 * A press refused on its content leaves a row — B976, the same rule
 * `test/helper-write-refusals.test.ts` asserts for the rest of the family.
 */
describe("a press refused on its content leaves a row", () => {
  test("edit_trip on an unknown trip", async () => {
    const res = await patch(editTrip, "https://t.test/api/helper/alex/trip", {
      trip: "nope",
      title: "x",
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("unknown_trip");

    const rows = await pressRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: 0, error: "unknown_trip", proposed: "edit_trip" });
  });

  test("trip_people with no email", async () => {
    const res = await patch(tripPeople, "https://t.test/api/helper/alex/trip/people", {
      trip: "reise",
      person: "Mara",
      email: "",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_people");

    const rows = await pressRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: 0, error: "invalid_people", proposed: "trip_people" });
  });
});
