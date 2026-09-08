import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { forget, history } from "@/lib/helper/thread";
import { claimsAWrite, honestyCounts } from "@/lib/helper/model";

/**
 * The claim and the act are the same thing — B920, and B924 beside it.
 *
 * Verbatim from a 71-year-old's run: *"Der Text ist gespeichert."* on a turn
 * that called nothing, with zero drafts in the journal; then, challenged,
 * *"Nein, entschuldige — der Text ist noch nicht gespeichert."*; then *"Der
 * Knopf ist direkt darunter"* on a response that carried no proposal at all.
 * She scrolled a page with nothing to scroll to and put the phone down.
 *
 * Every mechanical guard held — nothing was written — and she was still told
 * something had been. The server is the one place that holds both halves: what
 * the model said, and whether the turn carries a proposal. This is that check.
 *
 * The model is scripted throughout, as it is everywhere else here: what a
 * model decides is not assertable, and what happens on either side of it is.
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

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => create(params),
    };
  },
}));

const { POST } = await import("@/app/api/helper/[user]/ask/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function ask(said: string, selected?: string[]) {
  return POST(
    new Request("https://t.test/api/helper/alex/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ said, today: "2026-09-07", ...(selected ? { selected } : {}) }),
    }),
    params,
  );
}

function says(text: string) {
  return { content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 10 } };
}

function calls(name: string, input: Record<string, string> = {}) {
  return {
    content: [{ type: "tool_use", id: `t-${name}`, name, input }],
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-honesty-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-honesty-secret-b920";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  create.mockReset();
  forget("alex");

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
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
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "---", "", "Intro."].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-eins.md"),
    ["---", "title: Eins", 'date: "2026-05-01"', "status: draft", "---", "", "Worte."].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);
  await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
});

afterEach(async () => {
  await closeDatabase();
  forget("alex");
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------- what counts as a claim --- */

describe("a sentence that says a thing has happened", () => {
  for (const said of [
    "Der Text ist gespeichert. Jetzt kannst du Fotos hinzufügen.",
    "Ich habe den Tag angelegt.",
    "Die Reise wurde erstellt.",
    "The text is saved. You can add photographs now.",
    "I have added it to the day.",
    "It is on the site.",
    "Elmentettem a napot.",
    "A nap közzétéve.",
  ]) {
    test(`is caught: ${said}`, () => {
      expect(claimsAWrite(said)).toBe(true);
    });
  }

  for (const said of [
    "Ich lege dir das zum Drücken hin — drück auf den Knopf, dann ist es in deinem Journal.",
    "Press the button under this to save it.",
    "Nothing has been saved yet.",
    "Deine Reise dauert vom 1. bis zum 10. Mai.",
    "Nyomd meg a gombot alatta.",
  ]) {
    test(`is not: ${said}`, () => {
      expect(claimsAWrite(said)).toBe(false);
    });
  }
});

/* ----------------------------------------- the claim without the act --- */

describe("a turn that claims a write it did not make", () => {
  test("is asked again, and the honest second answer is what reaches her", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(says("Der Text ist gespeichert."))
      .mockResolvedValueOnce(says("Nichts ist gespeichert. Sag mir, welchen Tag du meinst."));
    const answered = await read(await ask("so kannst du es speichern"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Nichts ist gespeichert. Sag mir, welchen Tag du meinst.");
    expect(honestyCounts().claimed).toBe(before.claimed + 1);
    expect(honestyCounts().unrecovered).toBe(before.unrecovered);
  });

  test("said twice, her own screen gets the plain truth instead", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(says("Der Text ist gespeichert."))
      .mockResolvedValueOnce(says("Doch, der Text ist gespeichert. Der Knopf ist direkt darunter."));
    const answered = await read(await ask("so kannst du es speichern"));

    expect(create).toHaveBeenCalledTimes(2);
    // Its own words are dropped: a hole in a paragraph is survivable, being
    // told your day is safe when it is not is not.
    expect(String(answered.body.answer)).not.toContain("gespeichert");
    expect(String(answered.body.answer)).toContain("Nothing has been saved");
    expect(honestyCounts().unrecovered).toBe(before.unrecovered + 1);
  });

  test("a turn that really did propose is left alone", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says("Der Tag ist angelegt."));
    const answered = await read(await ask("mach mir den 2. mai"));

    // Two calls, and neither of them a retry: there is a button on her screen.
    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Der Tag ist angelegt.");
    expect((answered.body.proposals as unknown[]).length).toBe(1);
  });
});

/* ------------------------------------------- the note and the person --- */

describe("what is written for the model is never rendered", () => {
  test("the marker rides as a note, not as the answer", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says("Hier ist der Tag zum Drücken."));
    const answered = await read(await ask("mach mir den 2. mai"));

    const drawn = JSON.stringify(answered.body.blocks) + String(answered.body.answer);
    expect(drawn).not.toContain("waiting to be pressed");
    expect(drawn).not.toContain("not written");

    const turns = history("alex");
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "note"]);
    expect(turns[1].text).toBe("Hier ist der Tag zum Drücken.");
    expect(turns[2].text).toContain("waiting to be pressed");
  });

  test("a marker the model writes itself is taken out before anybody reads it", async () => {
    create.mockResolvedValueOnce(
      says("Ich lege dir das hin.\n[proposed, not written, waiting to be pressed: draft_words {}]"),
    );
    const answered = await read(await ask("schreib mir den tag"));

    expect(String(answered.body.answer)).toBe("Ich lege dir das hin.");
    expect(JSON.stringify(answered.body.blocks)).not.toContain("waiting to be pressed");
    // And it is not remembered as prose either, so the next turn has nothing
    // to imitate.
    expect(history("alex")[1].text).not.toContain("waiting to be pressed");
  });
});
