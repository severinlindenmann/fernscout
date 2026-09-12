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

/**
 * Gives the day real words directly on disk — B1561. These fixtures are
 * about the trip's own tracked questions (costs, coordinates, photos), not
 * about whether the day has been written up, and `publish_day` now refuses a
 * day that is still `NO_PROSE` with no gallery. A real sentence keeps every
 * one of these tests about what it was already testing.
 */
function giveWords(text = "Ein Tag am See.") {
  const dayDir = path.join(dir, "alex", "trips", "reise", "entries");
  for (const name of fs.readdirSync(dayDir)) {
    const file = path.join(dayDir, name);
    const raw = fs.readFileSync(file, "utf8");
    if (/\n…\n*$/.test(raw)) {
      fs.writeFileSync(file, raw.replace(/\n…\n*$/, `\n${text}\n`));
    }
  }
}

describe("a day written and put on the site, by pressing what the conversation offered", () => {
  test("two proposals and two presses, and no other call", async () => {
    const started = await propose("start_day");
    expect((await post(writeDay, "", pressed(started.proposal))).status).toBe(201);
    giveWords();

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
    giveWords();

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
    giveWords();

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
    giveWords();
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
    giveWords();

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
      // `start_day` (the "write" moment) makes a second, empty day — give it
      // words too, so a later `publish_day` iteration does not land on it and
      // refuse for B1561 reasons this test is not about.
      giveWords();
    }
  });
});

/**
 * A day that was never up does not come down, and one already up does not go
 * up twice — B951 and B1305, the two directions of the same symmetry.
 *
 * `unpublish_day` refuses a draft with `agent.tool.alreadyDraft` rather than
 * offering a confirmation card reading *"comes off the site and goes back to
 * being a draft"* about a day that had never been on the site. `publish_day`
 * used to have no such check for its own mirror case — asking to publish an
 * already-published day drew a full "read this the way your readers will"
 * card and a wasted press, even though the route's own `already_published`
 * 409 kept the write itself safe.
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
    giveWords();
    const publishing = await propose("publish_day");
    expect((await post(publishDay, "/publish", pressed(publishing.proposal))).status).toBe(200);

    const ran = await runTool("alex", "unpublish_day", { trip: "reise" }, say, "2026-09-07");
    expect(ran.proposal).toBeDefined();
  });
});

describe("publishing a day that is already up — B1305", () => {
  test("is refused with its own sentence, and no button", async () => {
    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));
    giveWords();
    const publishing = await propose("publish_day");
    expect((await post(publishDay, "/publish", pressed(publishing.proposal))).status).toBe(200);

    const ran = await runTool("alex", "publish_day", { trip: "reise" }, say, "2026-09-07");
    expect(ran.proposal).toBeUndefined();
    expect(JSON.stringify(ran.blocks)).toContain("agent.tool.alreadyPublished");
  });

  test("and a day still a draft still proposes", async () => {
    await propose("start_day").then(({ proposal }) => post(writeDay, "", pressed(proposal)));
    giveWords();

    const ran = await runTool("alex", "publish_day", { trip: "reise" }, say, "2026-09-07");
    expect(ran.proposal).toBeDefined();
  });
});

/**
 * Who will be able to read it, before the press — B933.
 *
 * She could only find out that her daughter had no access by reading
 * `people: []` and `invites: []` out of the API. Every persona in this project
 * has asked some version of *"can my mother read this"*, and the answer has
 * always cost a route call or a leap of faith — which is how B931 happened: a
 * trip set to `guest` so that one named person could read it, nobody
 * approved, and the model saying she was in.
 *
 * The fixture's trip is `private` with nobody named, which is the honest
 * worst case: **only you**.
 */
describe("what the publish card says about who can read it", () => {
  test("a private trip with nobody on it says only you, in words", async () => {
    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));
    giveWords();

    const { proposal } = await propose("publish_day");
    expect(proposal.sentence).toContain("agent.tool.publishReadersPrivateNobody");
    // And not the vocabulary: a person reading "private" has to know what this
    // codebase means by it, which is the trap AGENTS.md names.
    expect(proposal.sentence).not.toContain("agent.tool.publishReadersPublic");
  });

  test("named people are named", async () => {
    const file = path.join(dir, "alex", "trips", "reise", "trip.md");
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace("visibility: private", "visibility: private\npeople:\n  - name: Mara\n    email: mara@example.test"),
    );
    clearUserCache();

    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));
    giveWords();
    const { proposal } = await propose("publish_day");
    expect(proposal.sentence).toContain("agent.tool.publishReadersPrivate");
    expect(proposal.sentence).toContain("Mara");
  });

  test("a public trip says anybody", async () => {
    const file = path.join(dir, "alex", "trips", "reise", "trip.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("visibility: private", "visibility: public"));
    clearUserCache();

    const started = await propose("start_day");
    await post(writeDay, "", pressed(started.proposal));
    giveWords();
    const { proposal } = await propose("publish_day");
    expect(proposal.sentence).toContain("agent.tool.publishReadersPublic");
  });
});

/**
 * The paragraph that was thrown away — B969.
 *
 * The commonest thing anybody does here is describe a day in a sentence, and
 * the day usually does not exist yet. Four times out of four in an ordinary
 * write-up, the whole paragraph was dropped:
 *
 * > "On the 10th we landed around midday, dropped our bags at the hotel in
 * > Alfama, and spent the afternoon wandering the narrow streets…"
 *
 * > "A proposal to start an empty day for June 10th is on your screen. Once
 * > you press that, I can turn your notes into words for it."
 *
 * The notes went nowhere. They pressed, and typed the paragraph again. A third
 * of every turn in that run was somebody repeating themselves.
 *
 * `start_day` still makes an empty day — writing and reading back are two
 * steps here as everywhere else — but what they already said now rides across
 * the press to the card that offers to write it up.
 */
describe("a day described in the same breath as being asked for", () => {
  test("carries the notes on to the next card", async () => {
    const { proposal } = await propose("start_day", { notes: "Wir sind mittags gelandet." });
    expect(proposal.next?.tool).toBe("draft_words");
    // The browser sends the proposal's own arguments into the next one, so the
    // notes have to be there rather than only in a field nobody drew.
    expect(proposal.arguments.notes).toBe("Wir sind mittags gelandet.");
    // And the trip and slug come from what the route actually wrote, not from
    // what anybody guessed.
    expect(proposal.next?.from).toEqual({ trip: "trip", slug: "slug" });
  });

  test("and offers nothing extra when there was nothing said", async () => {
    const { proposal } = await propose("start_day");
    // A card asking to spend a credit writing up an empty day is worse than no
    // card at all.
    expect(proposal.next).toBeUndefined();
  });

  test("the day itself is still empty — this is a chain, not a shortcut", async () => {
    const started = await propose("start_day", { notes: "Wir sind mittags gelandet." });
    expect((await post(writeDay, "", pressed(started.proposal))).status).toBe(201);
    expect(dayFile()).not.toContain("mittags gelandet");
  });
});
