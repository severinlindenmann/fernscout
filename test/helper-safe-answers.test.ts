import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { issueCode, verifyCode, resolveSession, GUEST_COOKIE } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { REGISTRY, intentFor, refusalFor } from "@/lib/helper/intents";
import { getTrips } from "@/lib/trips";

/**
 * Round 1 of `docs/plans/2026-09-07-helper-everything.md` — the four ways this
 * box did the wrong thing confidently, or went quiet, at the moment somebody
 * most needed it not to. B817, B808, B783, B807.
 *
 * `routeAsk` is stubbed throughout and stubbed **hostile**: it answers
 * `write_day` at 0.99 for everything. That is the point of the first block —
 * a refusal that a confident guess can talk its way past is not a refusal, and
 * the misroute this replaces carried more confidence than the floor.
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

const { routeAsk } = vi.hoisted(() => ({ routeAsk: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  routeAsk,
}));

const { POST } = await import("@/app/api/helper/[user]/ask/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");
const { GET: dayRoute } = await import("@/app/api/helper/[user]/day/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function ask(said: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://t.test/api/helper/alex/ask", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ said, today: "2026-09-07" }),
    }),
    params,
  );
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-safe-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-safe-answers-secret";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  routeAsk.mockReset();
  // Hostile by default: the most confident possible answer, and the exact row
  // that opened the create-a-day screen when somebody asked to take one down.
  routeAsk.mockResolvedValue({ intent: "write_day", slots: {}, confidence: 0.99 });

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
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await consentRoute(
    new Request("https://t.test/api/helper/alex/consent", { method: "POST" }),
    params,
  );
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeTrip() {
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "visibility: private", "---", "", "Intro."].join("\n"),
  );
  const day = (date: string, slug: string, draft: boolean) =>
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", `${date}-${slug}.md`),
      ["---", `title: ${slug}`, `date: "${date}"`, ...(draft ? ["status: draft"] : []), "---", "", "Words."].join("\n"),
    );
  day("2026-05-01", "one", false);
  day("2026-05-02", "two", false);
  day("2026-05-03", "three", true);
}

/* ---------------------------------------------------------------- B817 --- */

describe("removal language never reaches a row that writes — B817", () => {
  const REMOVALS = [
    // en
    "take down the day with the photo of anna",
    "delete my acc",
    "remove the photo of anna",
    "get rid of yesterday",
    "unpublish the day about the ferry",
    "can you take the day with anna in it down",
    // de
    "lösche den Tag mit dem Foto von Anna",
    "entferne bitte das Foto von Anna",
    "nimm den Tag mit dem Foto von Anna runter",
    // hu
    "töröld a napot Anna fényképével",
    "vedd le a napot az oldalról",
    "távolítsd el a fényképet",
  ];

  for (const said of REMOVALS) {
    test(`"${said}" is refused by name, and opens nothing`, async () => {
      const answered = await read(await ask(said));
      expect(answered.status).toBe(200);
      expect(answered.body.intent).toBe("refuse_remove");
      expect(answered.body.refused).toBe("remove");
      // Not a screen, and not a set of fields: a sentence.
      expect(answered.body.kind).toBe("read");
      expect(answered.body.href).toBeUndefined();
      expect(answered.body.endpoint).toBeUndefined();
      expect(answered.body.fields).toBeUndefined();
      // And the model was never asked, so no confidence can reach past it.
      expect(routeAsk).not.toHaveBeenCalled();
    });
  }

  test("the answer does not claim this box could delete something", async () => {
    const answered = await read(await ask("take down the day with the photo of anna"));
    const said = String(answered.body.answer);
    expect(said).toContain("does not delete");
    // Where it actually happens: a mailbox, and a button in it.
    expect(said).toContain("email");
    expect(said).toContain("button");
  });

  test("an ordinary sentence is still routed", async () => {
    const answered = await read(await ask("put my photos up"));
    expect(answered.body.kind).toBe("open");
    expect(routeAsk).toHaveBeenCalledOnce();
  });
});

/* ---------------------------------------------------------------- B783 --- */

describe("a named refusal instead of silence — B783", () => {
  test("publishing says where publishing happens", async () => {
    const answered = await read(await ask("publish that day for me"));
    expect(answered.body.intent).toBe("refuse_publish");
    expect(String(answered.body.answer)).toContain("preview");
  });

  test("postcards say where the pressing happens", async () => {
    const answered = await read(await ask("send a postcard to my mum"));
    expect(answered.body.intent).toBe("refuse_postcard");
    expect(String(answered.body.answer)).toContain("postcards page");
  });

  test("all three refusals answer in German and Hungarian too", () => {
    for (const locale of ["de", "hu"]) {
      const dictionary = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "site", "locales", `${locale}.json`), "utf8"),
      ) as Record<string, string>;
      for (const name of ["Remove", "Publish", "Postcard"]) {
        expect(dictionary[`agent.askRefuse${name}`]?.length ?? 0).toBeGreaterThan(20);
      }
    }
  });

  test("a sentence nobody could map is still `unknown`, not a refusal", async () => {
    routeAsk.mockResolvedValue({ intent: "unknown", slots: {}, confidence: 0 });
    const answered = await read(await ask("asdf qwer zxcv"));
    expect(answered.body.intent).toBe("unknown");
    expect(refusalFor("asdf qwer zxcv")).toBeNull();
  });

  test("what the trip is called is answered, with its dates and its drafts", async () => {
    writeTrip();
    routeAsk.mockResolvedValue({ intent: "what_is_my_trip", slots: {}, confidence: 0.9 });
    const answered = await read(await ask("whats my trip called"));
    expect(answered.body.kind).toBe("read");
    const said = String(answered.body.answer);
    expect(said).toContain("Die Reise");
    expect(said).toContain("2026-05-01");
    expect(said).toContain("2026-05-10");
    expect(said).toContain("Days written: 2");
    expect(said).toContain("Still drafts: 1");
    // A read row, so nothing was written to say it.
    expect(getTrips("alex")).toHaveLength(1);
  });

  test("with no trip at all it says so rather than throwing", async () => {
    routeAsk.mockResolvedValue({ intent: "what_is_my_trip", slots: {}, confidence: 0.9 });
    const answered = await read(await ask("whats my trip called"));
    expect(String(answered.body.answer)).toContain("no trips");
  });
});

/* ---------------------------------------------------------------- B808 --- */

describe("the storage row stops catching sentences about stuff — B808", () => {
  test("its description is about bytes, and says it is not about where anything is", () => {
    const storage = intentFor("storage");
    expect(storage?.describe).toContain("disk space");
    expect(storage?.describe).toContain("storage limit");
    expect(storage?.describe).toMatch(/never where/i);
  });

  test("no row in the registry offers to say where something is", () => {
    for (const row of REGISTRY) {
      expect(row.describe).not.toMatch(/how much room this journal is using/i);
    }
  });
});

/* ---------------------------------------------------------------- B807 --- */

describe("a lapsed session says so — B807", () => {
  test("no session at all is told the session lapsed, not that this is not their journal", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const refused = await read(await ask("how much storage"));
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe("session_lapsed");
    expect(routeAsk).not.toHaveBeenCalled();
  });

  test("every route in the family answers alike, not only the ask box", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const refused = await read(
      await dayRoute(new Request("https://t.test/api/helper/alex/day?trip=reise&slug=x"), params),
    );
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe("session_lapsed");
  });

  test("a session that is simply not the owner's keeps the bare 404", async () => {
    resolveAccess.mockResolvedValue({ email: "someone-else@example.test" });
    const refused = await read(await ask("how much storage"));
    // A helper URL must not confirm whose journal it is, so this one is not
    // told anything at all — not even that they are signed in as somebody else.
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_your_journal");
    expect(refused.body.message).toBeUndefined();
  });

  test("a bearer token keeps B779's answer and its 404", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const refused = await read(await ask("how much storage", { authorization: "Bearer whatever" }));
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_your_journal");
    expect(String(refused.body.message)).toContain("/api/v1/<user>/");
  });

  /**
   * The half of B807 that had to be ruled out before anything was blamed: two
   * deploys landed during the tester's run, and a restart that signed people
   * out would have been the whole explanation.
   *
   * It is not. A session is a row, and the token is hashed with a plain
   * unsalted SHA-256 (`hashSecret`) rather than with `SESSION_SECRET`, so
   * nothing about it is held in a process. Closing the database and opening it
   * again is what a restart does to this code.
   */
  test("a session survives the process being restarted underneath it", async () => {
    const { code } = await issueCode("alex", OWNER_EMAIL, "guest");
    const verified = await verifyCode("alex", OWNER_EMAIL, code, "guest");
    if (!verified.ok) throw new Error("no session");
    expect(await resolveSession(verified.token, "guest")).not.toBeNull();
    expect(GUEST_COOKIE).toBe("fs_session");

    await closeDatabase();
    await migrateToLatest(await getDatabase());

    const after = await resolveSession(verified.token, "guest");
    expect(after?.email).toBe(OWNER_EMAIL);
  });
});
