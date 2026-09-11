import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { forget } from "@/lib/helper/thread";
import { claimsAWrite } from "@/lib/helper/model";

/**
 * B1323 — on the live instance, a postcard proposed and never pressed was
 * reported as already "on your postcards page", telling the person to go
 * and edit a card that did not exist:
 *
 * > A postcard from 5 September to Bea in Bern **is on your postcards page
 * > now**. […] You can add a signature and adjust it there, then press to
 * > send it to print.
 *
 * `claimsAWrite` used to be `false` for that sentence — `CLAIM` had no
 * pattern for an existence claim, only for verbs of doing ("saved",
 * "published"). The pending-proposal check at `model.ts`'s `amiss()` already
 * tests `claimsAWrite(answer) && proposals.some(unwritten)`, so the fix
 * widens `CLAIM` itself with the "is on your `<x>` page" shape, in English,
 * German and Hungarian, rather than widening the check's condition toward
 * `claimsWhatIsNotThere` — the latter also matches `claimsAButton` (a real
 * button really is honest to point at on a pending proposal), which would
 * have flagged `test/helper-honesty.test.ts`'s own honest case, *"a turn
 * that really did propose may point at the button"* ("Der Knopf dafür steht
 * bereit.", with an unwritten `start_day` proposal of its own).
 *
 * Kept in its own file for the same reason `test/helper-honesty-per-turn.ts`
 * is: `test/helper-honesty.test.ts`'s `ask()` calls already sit exactly at
 * `LIMIT.max` for `"helper-ask"` (40, an in-memory, per-module rate
 * limiter), so a call added there starves whatever runs after it.
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

function ask(said: string) {
  return POST(
    new Request("https://t.test/api/helper/alex/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ said, today: "2026-09-07" }),
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-honesty-postcard-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-honesty-postcard-secret-b1323";
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

describe("claimsAWrite, against the reported sentence directly", () => {
  test("an existence claim about a page is now caught, in English, German and Hungarian", () => {
    expect(
      claimsAWrite(
        "A postcard from 5 September to Bea in Bern is on your postcards page now. " +
          "It uses the first photograph from that day and the message you wrote. " +
          "You can add a signature and adjust it there, then press to send it to print.",
      ),
    ).toBe(true);
    expect(
      claimsAWrite("Eine Postkarte ist jetzt auf deiner Postkarten-Seite. Du kannst dort noch eine Unterschrift hinzufügen."),
    ).toBe(true);
    expect(claimsAWrite("A képeslap most már a képeslapok oldaladon van.")).toBe(true);
  });

  // The honest pointer must stay honest: a button really drawn this turn is
  // not an existence claim, whatever page it is near.
  test("pointing at a real button is still not a write claim", () => {
    expect(claimsAWrite("Der Knopf dafür steht bereit.")).toBe(false);
    expect(claimsAWrite("The button for that is ready.")).toBe(false);
  });
});

describe("a turn that proposes and then describes the result as already on a page", () => {
  test("is caught and asked again, in English", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(
        says("A day for 2 May is on your trip page now. You can add photographs there, then press to publish."),
      )
      .mockResolvedValueOnce(says("Der Knopf dafür steht bereit."));
    const answered = await read(await ask("mach mir den 2. mai"));

    expect(create).toHaveBeenCalledTimes(3);
    // The retry's honest answer — pointing at the button rather than
    // claiming the page — is what reaches her, unreplaced.
    expect(String(answered.body.answer)).toBe("Der Knopf dafür steht bereit.");
    expect(String(answered.body.answer)).not.toContain("is on your trip page");
    // The button it made is still there — the correction is to the claim,
    // never to the proposal.
    expect((answered.body.proposals as unknown[]).length).toBe(1);
  });

  test("is caught in German too", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says("Der Tag ist jetzt auf deiner Reise-Seite. Du kannst dort noch Fotos hinzufügen."))
      .mockResolvedValueOnce(says("Der Knopf dafür steht bereit."));
    const answered = await read(await ask("mach mir den 2. mai"));

    expect(create).toHaveBeenCalledTimes(3);
    expect(String(answered.body.answer)).toBe("Der Knopf dafür steht bereit.");
    expect(String(answered.body.answer)).not.toContain("Reise-Seite");
  });

  /**
   * The honest case this fix must survive, reproduced here rather than only
   * trusted from the other file: a proposal really is pending, nothing has
   * been written, and the model only points at the button that is really
   * there. `claimsAButton` is true for this sentence ("Knopf") and the
   * proposal is unwritten — the exact shape a naive widening toward
   * `claimsWhatIsNotThere` would have flagged.
   */
  test("a turn that really did propose may still point at the button, unflagged", async () => {
    create
      .mockResolvedValueOnce(calls("start_day", { trip: "Die Reise", date: "2026-05-02" }))
      .mockResolvedValueOnce(says("Der Knopf dafür steht bereit."));
    const answered = await read(await ask("mach mir den 2. mai"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Der Knopf dafür steht bereit.");
    expect((answered.body.proposals as unknown[]).length).toBe(1);
  });
});
