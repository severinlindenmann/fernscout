import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { clearLocaleCache } from "@/lib/locales";
import { speechLanguageFor } from "@/lib/helper/speech";
import { DRY_RUN_TRANSCRIPT, leastConfidentWord, UNCERTAIN_WORD_CONFIDENCE } from "@/lib/helper/transcribe";
import { hasPaid } from "./support/openCore";

/**
 * Speech into text — B686.
 *
 * **The provider is stubbed and nothing here reaches a network**, the same
 * discipline `test/helper-write-day.test.ts` uses for the model. What Deepgram
 * would say is not assertable; what is assertable is everything around it —
 * which language was asked for, what was charged, under what consent, and
 * that no recording is left on the disk afterwards.
 *
 * The `dry-run` backend is exercised for real, with no key set at all, because
 * that is the promise AGENTS.md makes: no feature needs a paid account to
 * develop or test.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { transcribeAudio } = vi.hoisted(() => ({ transcribeAudio: vi.fn() }));
vi.mock("@/lib/helper/transcribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/transcribe")>()),
  transcribeAudio,
}));

const { POST } = await import("@/app/api/helper/[user]/transcribe/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

/** Not audio, and it does not have to be: every backend is stubbed or canned.
 *  It only has to be bytes. */
const AUDIO = Buffer.from("not really audio, but bytes are bytes").toString("base64");

function json(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://t.test/api/helper/alex/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function call(over: Record<string, unknown> = {}) {
  return POST(
    json({ audio: AUDIO, mediaType: "audio/webm;codecs=opus", seconds: 12, idempotency_key: "one", ...over }),
    params,
  );
}

async function consent(scope: "words" | "photos" | "speech" = "speech") {
  return consentRoute(json({ scope }), params);
}

function writeServerConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features }),
  );
  clearConfigCache();
  clearUserCache();
}

function writeJournal(locales: string[]) {
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: locales[0],
      locales,
      baseCurrency: "CHF",
    }),
  );
  clearUserCache();
  clearLocaleCache();
}

/** Every file under the content root and the data dir, so "the audio is
 *  discarded" is a claim about the disk rather than about intent. */
function everyFile(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...everyFile(full));
    else out.push(full);
  }
  return out;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-speech-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-transcribe-secret-b686";
  delete process.env.DEEPGRAM_API_KEY;
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  transcribeAudio.mockReset();
  transcribeAudio.mockResolvedValue({ text: "We walked up to the pass.", seconds: 0 });
  clearIdempotencyStore();

  writeJournal(["en"]);
  writeServerConfig({
    auth: { enabled: true },
    transcription: { enabled: true, backend: "dry-run" },
  });
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.DEEPGRAM_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("which language is asked for", () => {
  test("a de-CH journal sends de-CH, never de", () => {
    expect(speechLanguageFor("", "de-CH", "de")).toBe("de-CH");
    expect(speechLanguageFor("", "de-CH", "en")).toBe("de-CH");
  });

  test("the journal's language beats the language the page is being read in", () => {
    expect(speechLanguageFor("", "hu", "en")).toBe("hu");
  });

  test("a regional tag this cannot transcribe narrows to its base language", () => {
    expect(speechLanguageFor("", "de-DE", null)).toBe("de");
  });

  test("an override is honoured, and an unsupported one is refused rather than approximated", () => {
    expect(speechLanguageFor("hu", "en", "en")).toBe("hu");
    expect(speechLanguageFor("es", "en", "en")).toBeNull();
  });

  test("a journal in a language nothing here transcribes falls to the reader's, then to nothing", () => {
    expect(speechLanguageFor("", "es", "de")).toBe("de");
    expect(speechLanguageFor("", "es", "pt")).toBeNull();
  });

  test("the route sends the journal's own language to the provider", async () => {
    writeJournal(["de-CH"]);
    await consent();
    const done = await read(await call());
    expect(done.status).toBe(200);
    expect(done.body.language).toBe("de-CH");
    expect(transcribeAudio.mock.calls[0][2]).toBe("de-CH");
  });

  test("a language nobody can transcribe is refused before any spend", async () => {
    writeJournal(["es"]);
    await consent();
    const refused = await read(await call({ locale: "es" }));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("unsupported_language");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});

describe("consent", () => {
  test("is refused with no consent at all", async () => {
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  test("consenting to words or photographs is not consent to send a voice", async () => {
    writeServerConfig({
      auth: { enabled: true },
      helper: { enabled: true },
      transcription: { enabled: true, backend: "dry-run" },
    });
    process.env.ANTHROPIC_API_KEY = "not-a-real-key";
    await consent("words");
    await consent("photos");
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(transcribeAudio).not.toHaveBeenCalled();
    delete process.env.ANTHROPIC_API_KEY;
  });

  test("consenting to speech specifically lets the call through", async () => {
    await consent();
    const done = await read(await call());
    expect(done.status).toBe(200);
    expect(done.body.text).toBe("We walked up to the pass.");
  });

  // B750 — a yes recorded for one provider must not cover a different one
  // the operator later switches to.
  test("switching the transcription backend after consent re-asks for speech", async () => {
    await consent(); // recorded under "dry-run", the backend configured above.

    process.env.DEEPGRAM_API_KEY = "not-a-real-key";
    writeServerConfig({
      auth: { enabled: true },
      transcription: { enabled: true, backend: "deepgram" },
    });

    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(transcribeAudio).not.toHaveBeenCalled();

    // Re-consenting records the new provider for speech only.
    await consent();
    const done = await read(await call());
    expect(done.status).toBe(200);
  });
});

// B2591 — transcription no longer spends or refunds credits; it needs an
// active plan or unused Free days (checked with `billing` on, a separate
// describe block below), and takes no AI day of its own.
describe("no plan or balance stands between a recording and its transcript", () => {
  beforeEach(async () => {
    await consent();
  });

  test("a recording within the ceiling still transcribes, whatever its length", async () => {
    const done = await read(await call({ seconds: 361 }));
    expect(done.status).toBe(200);
  });

  test("a retry under one idempotency key still calls the provider once", async () => {
    const first = await read(await call());
    const again = await read(await call());
    expect(again.body).toEqual(first.body);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
  });

  test("a failed provider call is reported cleanly", async () => {
    transcribeAudio.mockRejectedValueOnce(new Error("deepgram is unhappy"));
    const failed = await read(await call());
    expect(failed.status).toBe(502);
  });

  test("a recording longer than the ceiling is refused, whatever was claimed", async () => {
    const refused = await read(await call({ seconds: 1200 }));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("recording_too_long");
  });

  // The measured ceiling is enforced even when nobody claimed anything past
  // it: MAX_SPEECH_SECONDS is a promise about what this instance will pay
  // Deepgram for, not only about what a caller is honest enough to claim.
  test("a provider measuring past the ceiling is refused, whatever was claimed", async () => {
    transcribeAudio.mockResolvedValueOnce({ text: "A very long one.", seconds: 1200 });
    const refused = await read(await call({ seconds: 12 }));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("recording_too_long");
  });

  test("an honest short recording transcribes for nothing", async () => {
    transcribeAudio.mockResolvedValueOnce({ text: "Hi.", seconds: 3 });
    const done = await read(await call({ seconds: 0 }));
    expect(done.status).toBe(200);
    expect(done.body.text).toBe("Hi.");
  });
});

describe.skipIf(!hasPaid())("B2591 — with billing on", () => {
  beforeEach(async () => {
    writeServerConfig({
      auth: { enabled: true },
      transcription: { enabled: true, backend: "dry-run" },
      billing: { enabled: true },
    });
    await consent();
  });

  test("once the plan's AI days are used up, transcription is refused with 402 plan_limit", async () => {
    const { grantPlan } = await import("@paid/credits/lib/entitlements");
    const now = Date.now();
    await grantPlan({
      owner: "alex",
      plan: "pass",
      source: "admin",
      startsAt: new Date(now - 1000).toISOString(),
      endsAt: new Date(now + 100_000).toISOString(),
      periodStart: new Date(now - 1000).toISOString(),
      periodEnd: new Date(now + 100_000).toISOString(),
    });
    const { getDatabase } = await import("@/lib/db");
    const handle = await getDatabase();
    for (let i = 0; i < 21; i++) {
      await handle.db
        .insertInto("ai_days")
        .values({
          id: `seed-${i}`,
          owner_id: "alex",
          trip_id: "t",
          date: `2025-01-${String(i + 1).padStart(2, "0")}`,
          first_used_at: new Date(now - 1000).toISOString(),
          plan_period_start: new Date(now - 1000).toISOString(),
        })
        .execute();
    }
    const refused = await read(await call());
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({ error: "plan_limit", limit: "aiDays", used: 21, allowed: 21, plan: "pass" });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});

// B1803 — the `run` field (which run this recording was made inside, for a
// staging import) is still accepted and answered; B2592 removed the credit
// ledger that used to key a "spent on this run" figure off it.
describe("a recording made inside an import run", () => {
  beforeEach(async () => {
    await consent();
  });

  test("still transcribes when a run id is given", async () => {
    const done = await read(await call({ run: "run-1" }));
    expect(done.status).toBe(200);
  });

  test("a failed provider call inside a run is reported cleanly", async () => {
    transcribeAudio.mockRejectedValueOnce(new Error("deepgram is unhappy"));
    const failed = await read(await call({ run: "run-1" }));
    expect(failed.status).toBe(502);
  });
});

describe("the audio itself", () => {
  test("is not written anywhere — not under the content root, not under the data dir", async () => {
    await consent();
    const before = everyFile(dir);
    const done = await read(await call());
    expect(done.status).toBe(200);
    const after = everyFile(dir);
    // The only thing either call may add is the consent file and the database
    // the ledger lives in. Nothing that could hold a recording.
    const added = after.filter((file) => !before.includes(file));
    expect(added).toEqual([]);
    const raw = Buffer.from(AUDIO, "base64");
    for (const file of after) {
      expect(fs.readFileSync(file).includes(raw)).toBe(false);
    }
  });
});

describe("the dry-run backend", () => {
  test("works with no key set anywhere and returns the canned transcript", async () => {
    vi.doUnmock("@/lib/helper/transcribe");
    vi.resetModules();
    const real = await vi.importActual<typeof import("@/lib/helper/transcribe")>(
      "@/lib/helper/transcribe",
    );
    expect(process.env.DEEPGRAM_API_KEY).toBeUndefined();
    expect(real.speechBackend()).toBe("dry-run");
    expect(real.speechProvider()).toBe("dry-run");
    const said = await real.transcribeAudio(Buffer.from("bytes"), "audio/webm", "hu");
    expect(said.text).toBe(DRY_RUN_TRANSCRIPT);
    expect(said.seconds).toBe(0);
  });

  // B1803 Task 3.4 — the check-the-wording screen has to work locally, with
  // no Deepgram account, and it can only do that if dry-run hands it
  // *something* to highlight. The word itself has to actually be in the
  // canned transcript, or the screen would be pointing at nothing.
  test("flags one of its own words uncertain, so the check-the-wording screen has something real to show", async () => {
    vi.doUnmock("@/lib/helper/transcribe");
    vi.resetModules();
    const real = await vi.importActual<typeof import("@/lib/helper/transcribe")>(
      "@/lib/helper/transcribe",
    );
    const said = await real.transcribeAudio(Buffer.from("bytes"), "audio/webm", "en");
    expect(said.uncertainWord).toBeTruthy();
    expect(DRY_RUN_TRANSCRIPT).toContain(said.uncertainWord!.word);
    expect(said.uncertainWord!.occurrence).toBe(0);
  });
});

describe("leastConfidentWord — the check-the-wording screen's own flag (B1803 Task 3.4)", () => {
  test("names the single lowest-confidence word when it clears the bar", () => {
    const flagged = leastConfidentWord([
      { word: "we", punctuated_word: "We", confidence: 0.98 },
      { word: "fuong", punctuated_word: "Fuong,", confidence: 0.41 },
      { word: "think", punctuated_word: "think", confidence: 0.91 },
    ]);
    expect(flagged).toEqual({ word: "Fuong,", occurrence: 0 });
  });

  test("says nothing when every word is confident — silence, not a guess", () => {
    expect(
      leastConfidentWord([
        { word: "we", confidence: 0.98 },
        { word: "walked", confidence: 0.95 },
      ]),
    ).toBeUndefined();
  });

  test("says nothing at all when there is no per-word confidence — degrade to silence", () => {
    expect(leastConfidentWord(undefined)).toBeUndefined();
    expect(leastConfidentWord([])).toBeUndefined();
  });

  test("the threshold is the documented 0.6, not some other number nobody can see", () => {
    expect(
      leastConfidentWord([{ word: "x", confidence: UNCERTAIN_WORD_CONFIDENCE }]),
    ).toBeUndefined();
    expect(
      leastConfidentWord([{ word: "x", confidence: UNCERTAIN_WORD_CONFIDENCE - 0.01 }]),
    ).toEqual({ word: "x", occurrence: 0 });
  });

  // B1803 Task 3b fix round 2 — a word said twice must carry which
  // occurrence is the flagged one, not just its text: `splitOnWord`
  // (`components/extract/CheckWording.tsx`) used to always land on the
  // first occurrence in the transcript, regardless of which one this
  // function actually meant.
  test("carries which occurrence of a repeated word is the flagged one", () => {
    const flagged = leastConfidentWord([
      { word: "fuong", punctuated_word: "Fuong", confidence: 0.95 },
      { word: "or", confidence: 0.97 },
      { word: "fuong", punctuated_word: "Fuong", confidence: 0.41 },
    ]);
    expect(flagged).toEqual({ word: "Fuong", occurrence: 1 });
  });
});

describe("what the deepgram backend asks for", () => {
  // B1076 — the request must ask Deepgram not to retain the audio for model
  // training. Stubs global fetch; no real network call.
  test("the request carries mip_opt_out=true", async () => {
    vi.doUnmock("@/lib/helper/transcribe");
    vi.resetModules();
    const real = await vi.importActual<typeof import("@/lib/helper/transcribe")>(
      "@/lib/helper/transcribe",
    );
    process.env.DEEPGRAM_API_KEY = "dummy-key";
    writeServerConfig({
      auth: { enabled: true },
      transcription: { enabled: true, backend: "deepgram" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          metadata: { duration: 3 },
          results: { channels: [{ alternatives: [{ transcript: "hi" }] }] },
        }),
        { status: 200 },
      ),
    );
    try {
      expect(real.speechBackend()).toBe("deepgram");
      await real.transcribeAudio(Buffer.from("bytes"), "audio/webm", "en");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = fetchSpy.mock.calls[0][0] as URL;
      expect(new URL(calledUrl.toString()).searchParams.get("mip_opt_out")).toBe("true");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("which Deepgram host the audio goes to — B2472", () => {
  const saved = process.env.DEEPGRAM_API_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.DEEPGRAM_API_URL;
    else process.env.DEEPGRAM_API_URL = saved;
  });

  /** Sends one stubbed request with `override` set and says which host it went to. */
  async function hostCalled(override?: string): Promise<string> {
    if (override === undefined) delete process.env.DEEPGRAM_API_URL;
    else process.env.DEEPGRAM_API_URL = override;
    vi.doUnmock("@/lib/helper/transcribe");
    vi.resetModules();
    const real = await vi.importActual<typeof import("@/lib/helper/transcribe")>(
      "@/lib/helper/transcribe",
    );
    process.env.DEEPGRAM_API_KEY = "dummy-key";
    writeServerConfig({
      auth: { enabled: true },
      transcription: { enabled: true, backend: "deepgram" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          metadata: { duration: 3 },
          results: { channels: [{ alternatives: [{ transcript: "hi" }] }] },
        }),
        { status: 200 },
      ),
    );
    try {
      await real.transcribeAudio(Buffer.from("bytes"), "audio/webm", "en");
      return new URL(String(fetchSpy.mock.calls[0][0])).host;
    } finally {
      fetchSpy.mockRestore();
    }
  }

  test("the EU endpoint by default", async () => {
    expect(await hostCalled()).toBe("api.eu.deepgram.com");
  });

  test("an https override is used", async () => {
    expect(await hostCalled("https://api.deepgram.com/v1/listen")).toBe("api.deepgram.com");
  });

  test("a non-https or broken override is ignored", async () => {
    expect(await hostCalled("http://api.deepgram.com/v1/listen")).toBe("api.eu.deepgram.com");
    expect(await hostCalled("not a url")).toBe("api.eu.deepgram.com");
  });
});

describe("with the capability off", () => {
  test("the route answers 404 rather than failing", async () => {
    writeServerConfig({ auth: { enabled: true }, });
    const refused = await read(await call());
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("transcription_unavailable");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  test("it comes on with no other capability switched on", async () => {
    writeServerConfig({
      auth: { enabled: true },
      transcription: { enabled: true, backend: "dry-run" },
    });
    const answer = await read(await call());
    expect(answer.body.error).not.toBe("transcription_unavailable");
  });
});

describe("bearer tokens", () => {
  test("are refused; only the owner's cookie is honoured", async () => {
    await consent();
    resolveAccess.mockResolvedValueOnce({ email: null });
    const refused = await read(
      await POST(
        json({ audio: AUDIO, mediaType: "audio/webm", seconds: 3 }, { authorization: "Bearer not-a-cookie" }),
        params,
      ),
    );
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_your_journal");
  });
});
