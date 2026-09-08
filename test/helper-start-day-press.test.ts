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

const { POST } = await import("@/app/api/helper/[user]/day/route");

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
      features: { auth: { enabled: true }, helper: { enabled: true } },
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

describe("pressing the proposal the conversation offered", () => {
  test("writes a day, with no other call and nothing invented", async () => {
    const proposal = await propose();
    const answered = await post(pressed(proposal));
    expect(answered.status).toBe(201);

    const written = entries();
    expect(written).toHaveLength(1);
    const day = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", written[0]),
      "utf8",
    );
    // Nobody has been asked, and the day says exactly that — never a decline,
    // which would put "nothing was spent" into somebody's journal as fact.
    expect(day).toContain("unrecorded: [costs, coordinates]");
    expect(day).not.toContain("without:");
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
    const answered = await post({ ...body, costs: "none" });
    expect(answered.status).toBe(201);
    const day = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", entries()[0]),
      "utf8",
    );
    expect(day).toContain("without: [costs]");
    expect(day).toContain("unrecorded: [coordinates]");
  });

  test("a trip that keeps track of nothing is asked nothing", async () => {
    const file = path.join(dir, "alex", "trips", "reise", "trip.md");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace("visibility: private", "visibility: private\ntracks:\n  costs: false\n  coordinates: false"),
    );
    clearUserCache();
    const proposal = await propose();
    expect(proposal.fields.map((f) => f.name)).toEqual(["trip", "date"]);
    expect(proposal.sentence).not.toContain("agent.tool.startDayUnknown");
    expect((await post(pressed(proposal))).status).toBe(201);
  });
});
