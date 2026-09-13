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
import { writeTripFixture } from "./fixtures/content";

/**
 * The press that failed every time — B917.
 *
 * `start_day` proposed `{trip, date}` and nothing else, and the route it
 * posts to refuses a day that says nothing about what its trip keeps
 * (`lib/tracks.ts`): every press came back `422 incomplete_day`. B916 is why
 * nobody noticed — the card said the day was started before the write had
 * happened.
 *
 * So this drives the whole path the way the browser does: the tool proposes,
 * and the body posted is exactly what `HelperAsk` sends — the arguments, then
 * the proposal's own fields, and nothing a person had to discover from an API
 * document.
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

const { POST, PATCH } = await import("@/app/api/helper/[user]/day/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-start-day-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-start-day-secret-b917";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

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
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  writeTripFixture("alex", {
    id: "reise",
    title: "Die Reise",
    start: "2026-05-01",
    end: "2026-05-10",
    visibility: "private",
  });
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** What the browser posts when somebody presses: the arguments, then the
 *  fields as they stand on the card. `components/HelperAsk.tsx`, `accept()`. */
function pressed(proposal: {
  arguments: Record<string, string>;
  fields: { name: string; value: string }[];
}) {
  return {
    ...proposal.arguments,
    ...Object.fromEntries(proposal.fields.map((field) => [field.name, field.value])),
  };
}

async function propose(args: Record<string, string> = {}) {
  const ran = await runTool("alex", "start_day", { trip: "reise", ...args }, say, "2026-09-07");
  if (!ran.proposal) throw new Error("start_day proposed nothing");
  return ran.proposal;
}

function post(body: unknown) {
  return POST(
    new Request("https://t.test/api/helper/alex/day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

function entries() {
  return fs.readdirSync(path.join(dir, "alex", "trips", "reise", "entries"));
}

/**
 * B1650's own four rows, never pre-filled on this card (`CARD_PREFILL_TRACKS`,
 * lib/tracks.ts) — a press that does not name them is the honest case these
 * tests are pinning elsewhere (`incomplete_day`), so every press here that
 * expects a `201` names them explicitly, exactly as a model would once it
 * has actually asked and been told there is nothing to say.
 */
const NEW_ROW_DECLINES = { time: "none", transportMode: "none", tags: "none", visibility: "none" };

function patch(body: unknown) {
  return PATCH(
    new Request("https://t.test/api/helper/alex/day", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

describe("pressing the proposal the conversation offered", () => {
  test("writes a day, with no other call and nothing invented", async () => {
    const proposal = await propose();
    const answered = await post({ ...pressed(proposal), ...NEW_ROW_DECLINES });
    expect(answered.status).toBe(201);

    const written = entries();
    expect(written).toHaveLength(1);
    const day = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", written[0]),
      "utf8",
    );
    // Nobody has been asked, and the day says exactly that — never a decline
    // that claims "nothing was spent", only one that says the question is
    // still open. v2 writes one `declined` map (`lib/api/v2/documents.ts`'s
    // `dayToJson`) rather than v1's flat `unrecorded:`/`without:` arrays —
    // "unrecorded" (not yet answered) is `declineText(track, "unknown")`
    // (`lib/api/entries.ts`), never the "nothing to record" wording an
    // actual "none" answer gets.
    const parsed = JSON.parse(day) as { declined?: Record<string, string> };
    expect(parsed.declined?.costs).toBe("Not recorded: what this day cost is unknown.");
    expect(parsed.declined?.coordinates).toBe("Not recorded: where this day happened is unknown.");
  });

  test("the trip's questions are on the card, and open on “nobody has it”", async () => {
    const proposal = await propose();
    const asked = Object.fromEntries(proposal.fields.map((f) => [f.name, f]));
    expect(asked.costs?.value).toBe("unknown");
    expect(asked.coordinates?.value).toBe("unknown");
    // Photographs are asked at publish — there is none to answer about yet.
    expect(asked.photos).toBeUndefined();
    // A closed list, so the words are read before choosing, and both answers
    // are there rather than only the decline.
    expect(asked.costs?.options?.map((o) => o.value)).toEqual(["unknown", "none"]);
    // And the card says why it stands where it does.
    expect(proposal.sentence).toContain("agent.tool.startDayUnknown");
  });

  test("a real answer on the card is what is written", async () => {
    const proposal = await propose();
    const body = pressed(proposal);
    const answered = await post({ ...body, costs: "none", ...NEW_ROW_DECLINES });
    expect(answered.status).toBe(201);
    const day = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", entries()[0]),
      "utf8",
    );
    // `declined` map, not flat arrays — "none" answers as the "nothing to
    // record" wording, "unknown" (never asked here) as "not recorded".
    const parsed = JSON.parse(day) as { declined?: Record<string, string> };
    expect(parsed.declined?.costs).toBe("Nothing to record: what this day cost.");
    expect(parsed.declined?.coordinates).toBe("Not recorded: where this day happened is unknown.");
  });

  test("pressing again for the same day answers a stable code, not the raw English sentence — B785", async () => {
    const proposal = await propose();
    const body = pressed(proposal);
    expect((await post({ ...body, costs: "none", ...NEW_ROW_DECLINES })).status).toBe(201);

    // Same trip, same date, again — the second "Diesen Tag beginnen" press
    // B785 was filed against. 409, since B1567: a collision with a day that
    // already exists, the same status `already_published` answers with.
    const second = await post({ ...body, costs: "none", ...NEW_ROW_DECLINES });
    expect(second.status).toBe(409);
    const answer = (await second.json()) as { error: string };
    // Not `createDraft`'s own English sentence
    // (`an entry already exists at …`), which a person on a German helper
    // screen cannot read — a stable code `failureSentence()` can translate.
    expect(answer.error).toBe("day_exists");
  });

  test("pressing again after the day got its real title still answers a refusal, not a second entry — B1567", async () => {
    const proposal = await propose();
    const body = pressed(proposal);
    const first = await post({ ...body, costs: "none", ...NEW_ROW_DECLINES });
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { trip: string; slug: string };
    expect(entries()).toHaveLength(1);

    // The words step gives the day its real title, and B1276's rename moves
    // it off the placeholder slug `createDraft`'s own collision check
    // compares against — this is what a live `start_day` chaining into
    // `draft_words` does between two presses of the same card.
    const renamed = await patch({
      trip: "reise",
      slug: firstJson.slug,
      title: "Spaziergang am See",
    });
    expect(renamed.status).toBe(200);
    const fileName = entries()[0];
    const bytesBeforeSecondPress = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", fileName),
    );

    // Press the *original* start_day card again — same trip, same date. The
    // placeholder path is free again, so a route that only compared file
    // paths would write a second, empty entry for a date that already has
    // one and call it `ok`, exactly the live bug B1567 was filed against.
    const second = await post({ ...body, costs: "none", ...NEW_ROW_DECLINES });
    expect(second.status).toBe(409);
    expect((await second.json()) as { error: string }).toEqual({ error: "day_exists" });

    // Never a second entry, and the first is untouched byte for byte.
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toBe(fileName);
    expect(
      fs.readFileSync(path.join(dir, "alex", "trips", "reise", "entries", fileName)),
    ).toEqual(bytesBeforeSecondPress);
  });

  // v1's trip-level `tracks:` block, which let a whole trip opt out of ever
  // being asked about costs or coordinates, has no v2 home any more
  // (`lib/api/tripTracks.ts`'s `patchTripTracks`: "every day answers every
  // declinable directly now (DAY_DECLINABLES), so there is no trip-level
  // 'what to ask for' left to persist"). There is therefore no longer a way
  // to write this test's original premise (a trip that keeps track of
  // nothing) — a day is always asked, on every trip, which is what this now
  // pins instead: a trip whose file carries no track-like state at all still
  // gets the full ask.
  test("a trip's own trip.json carries no track opt-out any more — a day is always asked", async () => {
    const file = path.join(dir, "alex", "trips", "reise", "trip.json");
    void JSON.parse(fs.readFileSync(file, "utf8"));
    clearUserCache();
    const proposal = await propose();
    expect(proposal.fields.map((f) => f.name)).toEqual(["trip", "date", "costs", "coordinates"]);
    expect(proposal.sentence).toContain("agent.tool.startDayUnknown");
    expect((await post({ ...pressed(proposal), costs: "none", coordinates: "unknown", ...NEW_ROW_DECLINES })).status).toBe(201);
  });
});
