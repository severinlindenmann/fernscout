import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { publishNotice } from "@/lib/api/entries";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
import { setJournalProfile } from "@/lib/journals";
import { VISIBILITIES } from "@/lib/tripWrite";

/**
 * Four small places where this software said something that was not true —
 * B775, B777, B778 and B779, all found in one afternoon against the live
 * instance. They are one theme and are tested together for that reason: each
 * is a sentence a person or an agent had no way to check.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: null as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { PATCH: editDayRoute } = await import(
  "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route"
);
const { GET: helperDayRoute } = await import("@/app/api/helper/[user]/day/route");

let dir: string;

function writeInstance() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      // Weather is off here, which is the whole of B778: the capability the
      // journal cannot have because the server does not offer it.
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "Zurich",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", 'title: "Reise"', 'start: "2026-09-01"', 'end: "2026-09-05"',
      "status: current", "visibility: public", "---", "", "Body.", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-09-02-a-day.md"),
    ["---", 'title: "A day"', 'date: "2026-09-02"', "status: draft", "---", "", "Prose.", ""].join(
      "\n",
    ),
  );
  clearConfigCache();
  clearUserCache();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-claims-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "what-the-software-claims-test-secret";
  resolveAccess.mockResolvedValue({ email: null });
  writeInstance();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------- B775 --- */

describe("B775 — what publishing a day actually did", () => {
  const day = { title: "Lanterns", date: "2026-08-26", url: "https://t.test/alex", test: false };

  test("a public trip: the feed, the search index, and anyone with the link", () => {
    const notice = publishNotice({ ...day, visibility: "public", listed: true });
    expect(notice).toContain("the feed and the search index");
    expect(notice).toContain("anyone with the link can read it");
  });

  test("a guest trip: the people let into this journal, and no feed and no link", () => {
    const notice = publishNotice({ ...day, visibility: "guest", listed: false });
    expect(notice).toContain("The trip is guest");
    expect(notice).toContain("the people you have approved into this journal");
    // The three claims that were false and frightening. An owner who chose
    // `guest` must not be told a stranger with the link can now read it.
    expect(notice).not.toMatch(/feed|search index|link/i);
  });

  test("a private trip: the people who were there, and nobody else", () => {
    const notice = publishNotice({ ...day, visibility: "private", listed: false });
    expect(notice).toContain("The trip is private");
    expect(notice).toContain("the people listed on the trip");
    expect(notice).not.toMatch(/feed|search index|link/i);
  });

  test("a public trip nobody advertises does not claim the feed either", () => {
    const notice = publishNotice({ ...day, visibility: "public", listed: false });
    expect(notice).toContain("anyone with the link can read it");
    expect(notice).toContain("kept out of the feed, the search index and the sitemap");
  });

  test("every visibility is answered, and only a public one promises discovery", () => {
    // Reads the vocabulary rather than a list typed here, so a fourth value
    // cannot be added and quietly fall through to the public sentence.
    for (const visibility of VISIBILITIES) {
      const notice = publishNotice({ ...day, visibility, listed: true });
      expect(notice).toContain('"Lanterns" (2026-08-26) is on https://t.test/alex.');
      expect(/feed/.test(notice)).toBe(visibility === "public");
    }
  });

  test("a test day on a closed trip says it is a test and still names who can read it", () => {
    const notice = publishNotice({ ...day, test: true, visibility: "guest", listed: false });
    expect(notice).toContain("test: true");
    expect(notice).not.toMatch(/feed|search index|link/i);
  });

  /* ------------------------------------------------------------ B805 --- */

  /**
   * The note is written for an agent to relay and `/agent.md` tells it to
   * read the sentence out rather than paraphrase — so it reaches the person
   * verbatim, and until B805 that meant a German owner met an English
   * sentence containing the English word `guest`, on exactly the distinction
   * (a guest of the journal, not of the trip) this project already knows
   * people get wrong.
   */
  test("a German journal's note is German, including the word for who can read it", () => {
    const notice = publishNotice({ ...day, visibility: "guest", listed: false, locale: "de" });
    expect(notice).toContain("nur für Gäste");
    expect(notice).toContain("die du in dieses Journal aufgenommen hast");
    // No English left in it at all — not the vocabulary word, not the tail.
    expect(notice).not.toMatch(/\bguest\b|\bpublic\b|\bprivate\b/i);
    expect(notice).not.toMatch(/can be read by|Taking it down/);
  });

  test("every visibility answers in German without falling back to an English word", () => {
    for (const visibility of VISIBILITIES) {
      const notice = publishNotice({ ...day, visibility, listed: true, locale: "de" });
      expect(notice, visibility).not.toMatch(/\bguest\b|\bpublic\b|\bprivate\b/i);
      expect(notice, visibility).toContain("Lanterns");
    }
  });

  test("no locale still reads exactly as it always did — the two doors that know no journal", () => {
    expect(publishNotice({ ...day, visibility: "guest", listed: false })).toContain(
      "The trip is guest",
    );
  });
});

/* ---------------------------------------------------------------- B777 --- */

describe("B777 — creating a journal and correcting one refuse the same languages", () => {
  test("every maintained language is accepted by the correction", () => {
    for (const code of MAINTAINED_LOCALES) {
      const result = setJournalProfile("alex", { locales: [code], defaultLocale: code });
      expect(result.ok, `${code} was refused`).toBe(true);
    }
  });

  test("a language this instance does not maintain is refused, as at creation", () => {
    // "fr" is the live finding: accepted with a plain 200, leaving a journal
    // whose config claimed French and whose chrome was English.
    const outside = ["fr", "es", "de-DE"].filter(
      (code) => !(MAINTAINED_LOCALES as readonly string[]).includes(code),
    );
    for (const code of outside) {
      const locales = setJournalProfile("alex", { locales: ["en", code] });
      expect(locales.ok, `locales accepted ${code}`).toBe(false);
      if (!locales.ok) {
        expect(locales.error).toBe("invalid_locales");
        // The create route's own words, both halves of them.
        expect(locales.message).toContain("must be one of");
        for (const maintained of MAINTAINED_LOCALES) {
          expect(locales.message).toContain(`\`${maintained}\``);
        }
      }

      const one = setJournalProfile("alex", { defaultLocale: code });
      expect(one.ok, `defaultLocale accepted ${code}`).toBe(false);
      if (!one.ok) expect(one.error).toBe("invalid_defaultLocale");
    }
  });

  test("nothing was written when a language was refused", () => {
    setJournalProfile("alex", { locales: ["en", "fr"] });
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8"),
    ) as { locales: string[] };
    expect(onDisk.locales).toEqual(["en"]);
  });
});

/* ---------------------------------------------------------------- B778 --- */

describe("B778 — asking for a lookup nobody will make", () => {
  async function patchDay(token: string, body: unknown) {
    const response = await editDayRoute(
      new Request("https://t.test/api/v1/alex/trips/reise/days/a-day", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise", slug: "a-day" }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function agentToken(): Promise<string> {
    const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
    const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
    if (!verified.ok) throw new Error("could not mint a token");
    return verified.token;
  }

  test("weather: true with the capability off is refused, in the answer to that call", async () => {
    const token = await agentToken();
    const refused = await patchDay(token, { weather: true });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("weather_disabled");
    expect(String(refused.body.message)).toContain("/api/health");
    // The old answer, which is what this exists to prevent.
    expect(refused.body.changed).toBeUndefined();
    // And nothing was written: the day is untouched.
    const file = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-09-02-a-day.md"),
      "utf8",
    );
    expect(file).not.toContain("weather");
  });

  test("withdrawing the request is not refused — there is nothing to service", async () => {
    const token = await agentToken();
    const answer = await patchDay(token, { weather: false });
    expect(answer.status).toBe(200);
  });
});

/* ---------------------------------------------------------------- B779 --- */

describe("B779 — a token on the helper's door", () => {
  const params = { params: Promise.resolve({ user: "alex" }) };

  test("a bearer token is still 404, and is told where its door is", async () => {
    const response = await helperDayRoute(
      new Request("https://t.test/api/helper/alex/day?trip=reise&slug=a-day", {
        headers: { authorization: "Bearer fs_agent_whatever" },
      }),
      params,
    );
    const body = (await response.json()) as Record<string, unknown>;
    // The status does not move: a helper URL must not confirm whose journal
    // this is.
    expect(response.status).toBe(404);
    expect(body.error).toBe("not_your_journal");
    const message = String(body.message);
    expect(message).toContain("/api/v1/<user>/");
    expect(message).toContain("cookie");
  });

  test("a browser with no session is told its session lapsed — B807", async () => {
    const response = await helperDayRoute(
      new Request("https://t.test/api/helper/alex/day?trip=reise&slug=a-day"),
      params,
    );
    const body = (await response.json()) as Record<string, unknown>;
    // It used to be the bare 404, and a person mid-task read that as the
    // software being broken. This says nothing about the journal — with no
    // address, every username here answers alike — and the screen puts the
    // way back in beside it.
    expect(response.status).toBe(401);
    expect(body.error).toBe("session_lapsed");
    expect(body.message).toBeUndefined();
  });
});
