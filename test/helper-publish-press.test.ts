import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { TOOLS, runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";

/**
 * The press she could never make — B929.
 *
 * Twenty-three messages and the day never went up. Publishing needs the
 * trip's **photographs** question answered — `photos` is a `publish` row in
 * `lib/tracks.ts` — and `publish_day` could not answer it, so every press came
 * back `422 incomplete_day`. B917 fixed the same shape at the other end of a
 * day's life and left this one, correctly at the time: at creation there is no
 * photograph to answer about.
 *
 * So this drives the whole journey the way she would have: propose a day,
 * press it, propose publishing it, press that — and nothing else. No API call
 * anybody had to read a document to find.
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

const { POST: writeDay } = await import("@/app/api/helper/[user]/day/route");
const { POST: publishDay } = await import("@/app/api/helper/[user]/day/publish/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-publish-press-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-publish-press-secret-b929";
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

async function propose(tool: string, args: Record<string, string> = {}) {
  const ran = await runTool("alex", tool, { trip: "reise", ...args }, say, "2026-09-07");
  if (!ran.proposal) throw new Error(`${tool} proposed nothing`);
  return { proposal: ran.proposal, blocks: ran.blocks };
}

function post(
  route: (request: Request, context: typeof params) => Promise<Response>,
  where: string,
  body: unknown,
) {
  return route(
    new Request(`https://t.test/api/helper/alex/day${where}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

function dayFile() {
  const dayDir = path.join(dir, "alex", "trips", "reise", "entries");
  const [first] = fs.readdirSync(dayDir);
  return fs.readFileSync(path.join(dayDir, first), "utf8");
}

describe("a day written and put on the site, by pressing what the conversation offered", () => {
  test("two proposals and two presses, and no other call", async () => {
    const started = await propose("start_day");
    expect((await post(writeDay, "", pressed(started.proposal))).status).toBe(201);

    const publishing = await propose("publish_day");
    const answered = await post(publishDay, "/publish", pressed(publishing.proposal));
    expect(answered.status).toBe(200);
    expect((await answered.json()).ok).toBe(true);

    const day = dayFile();
    expect(day).not.toContain("status: draft");
    // Nobody was asked, and the day says exactly that about all three rows —
    // never a decline, which would put "there were no photographs" into
    // somebody's journal as a fact about their day.
    expect(day).toContain("unrecorded: [costs, coordinates, photos]");
    expect(day).not.toContain("without:");
  });

  test("the photographs question is on the confirmation, opening on “nobody has it”", async () => {
    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));

    const { proposal, blocks } = await propose("publish_day");
    const asked = Object.fromEntries(proposal.fields.map((field) => [field.name, field]));
    expect(asked.photos?.value).toBe("unknown");
    expect(asked.photos?.options?.map((one) => one.value)).toEqual(["unknown", "none"]);
    // Answered at creation, so not asked again.
    expect(asked.costs).toBeUndefined();
    expect(proposal.sentence).toContain("agent.tool.publishDayUnknown");

    // And it is on her screen: a confirmation draws the questions it cannot go
    // through without, and still no editable trip or slug.
    const confirm = blocks.find((block) => block.shape === "confirm");
    expect(confirm?.shape === "confirm" && confirm.fields?.map((one) => one.name)).toEqual([
      "photos",
    ]);
  });

  test("her own answer is what is written into the day", async () => {
    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));

    const { proposal } = await propose("publish_day");
    const answered = await post(publishDay, "/publish", {
      ...pressed(proposal),
      photos: "none",
    });
    expect(answered.status).toBe(200);

    const day = dayFile();
    expect(day).toContain("without: [photos]");
    expect(day).toContain("unrecorded: [costs, coordinates]");
  });

  test("a trip that keeps track of nothing is asked nothing at publish either", async () => {
    const file = path.join(dir, "alex", "trips", "reise", "trip.md");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(
          "visibility: private",
          "visibility: private\ntracks:\n  costs: false\n  coordinates: false\n  photos: false",
        ),
    );
    clearUserCache();

    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));
    const { proposal } = await propose("publish_day");
    expect(proposal.fields.map((field) => field.name)).toEqual(["trip", "slug"]);
    expect((await post(publishDay, "/publish", pressed(proposal))).status).toBe(200);
  });
});

/**
 * The third instance, caught here rather than by a tester — B929.
 *
 * Two tools post into a route that asks a day what its trip keeps, at two
 * different moments in its life, and each one has now shipped unable to answer
 * once. So the rule is asserted of the registry: **a write tool whose press
 * lands on a route that runs `missingFrom` must ask every row that route would
 * refuse it for.** A third tool posting there, or a fourth row in `TRACKS`,
 * fails here.
 */
describe("no write tool posts into a question it cannot answer", () => {
  const MOMENTS: Record<string, "write" | "publish"> = {
    "/api/helper/alex/day": "write",
    "/api/helper/alex/day/publish": "publish",
  };

  test("start_day and publish_day are what this covers", () => {
    const covered = TOOLS.filter(
      (tool) =>
        tool.kind === "write" && tool.method === undefined && MOMENTS[tool.endpoint("alex")],
    ).map((tool) => tool.name);
    expect(covered).toEqual(["start_day", "publish_day"]);
  });

  test("each of them asks every row its route would refuse", async () => {
    // A day exists, so `publish_day` has something to propose about.
    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));

    for (const tool of TOOLS) {
      if (tool.kind !== "write" || tool.method !== undefined) continue;
      const moment = MOMENTS[tool.endpoint("alex")];
      if (!moment) continue;

      const { proposal } = await propose(tool.name);
      const asks = new Set(proposal.fields.filter((field) => field.options).map((f) => f.name));
      // Whatever the route would refuse for is what the card has to carry. The
      // proposal is pressed with exactly these values, so if the press goes
      // through, the questions were enough.
      const route = moment === "write" ? writeDay : publishDay;
      const where = moment === "write" ? "" : "/publish";
      const answered = await post(route, where, pressed(proposal));
      expect([201, 200], `${tool.name} asked ${[...asks].join(", ")}`).toContain(answered.status);
    }
  });
});

/**
 * A day that was never up does not come down — B951.
 *
 * `publish_day` has always refused a day already published. Its mirror had no
 * such check, so asking to take down a draft produced a confirmation card
 * reading *"comes off the site and goes back to being a draft"* — about a day
 * that had never been on the site. The press would have answered
 * `already_draft`; what she read before pressing said her day was live.
 */
describe("taking down a day that was never up", () => {
  test("is refused with its own sentence, and no button", async () => {
    const started = await propose("start_day");
    expect((await post(writeDay, "", pressed(started.proposal))).status).toBe(201);

    const ran = await runTool("alex", "unpublish_day", { trip: "reise" }, say, "2026-09-07");
    expect(ran.proposal).toBeUndefined();
    expect(JSON.stringify(ran.blocks)).toContain("agent.tool.alreadyDraft");
  });

  test("and a day that is up still proposes", async () => {
    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));
    const publishing = await propose("publish_day");
    expect((await post(publishDay, "/publish", pressed(publishing.proposal))).status).toBe(200);

    const ran = await runTool("alex", "unpublish_day", { trip: "reise" }, say, "2026-09-07");
    expect(ran.proposal).toBeDefined();
  });
});
