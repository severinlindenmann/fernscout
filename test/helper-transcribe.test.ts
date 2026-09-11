import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant } from "@/lib/credits";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { clearLocaleCache } from "@/lib/locales";
import { creditsForSeconds, speechLanguageFor } from "@/lib/helper/speech";
import { DRY_RUN_TRANSCRIPT } from "@/lib/helper/transcribe";

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
    credits: { enabled: true },
    transcription: { enabled: true, backend: "dry-run" },
  });
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.DEEPGRAM_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a recording costs", () => {
  // B987 — the rate did not change and the grain did: five minutes is still
  // one credit, and the six-second question that used to cost the same as
  // five minutes now costs two hundredths.
  test("five minutes is still one credit, and the rate is unchanged either side of it", () => {
    expect(creditsForSeconds(300)).toBe(1);
    expect(creditsForSeconds(600)).toBe(2);
    expect(creditsForSeconds(900)).toBe(3);
  });

  test("a short recording costs a fraction, not a whole credit", () => {
    expect(creditsForSeconds(1)).toBe(0.01);
    expect(creditsForSeconds(3)).toBe(0.01);
    expect(creditsForSeconds(6)).toBe(0.02);
    expect(creditsForSeconds(61)).toBe(0.21);
  });

  test("any recording at all costs something — a charge of nothing cannot be audited", () => {
    expect(creditsForSeconds(0.4)).toBe(0.01);
    expect(creditsForSeconds(0)).toBe(0.01);
    expect(creditsForSeconds(-1)).toBe(0.01);
  });

  test("is always a whole number of hundredths, which is what `spend` requires", () => {
    for (const seconds of [0.4, 7, 59.5, 240.2, 631]) {
      const credits = creditsForSeconds(seconds);
      expect(Number.isInteger(Math.round(credits * 100))).toBe(true);
      expect(Math.abs(Math.round(credits * 100) - credits * 100)).toBeLessThan(1e-6);
    }
  });
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
    expect(speechLanguageFor("fr", "en", "en")).toBeNull();
  });

  test("a journal in a language nothing here transcribes falls to the reader's, then to nothing", () => {
    expect(speechLanguageFor("", "fr", "de")).toBe("de");
    expect(speechLanguageFor("", "fr", "it")).toBeNull();
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
    writeJournal(["fr"]);
    await consent();
    const refused = await read(await call({ locale: "fr" }));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("unsupported_language");
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });
});

describe("consent", () => {
  test("is refused with no consent at all", async () => {
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  test("consenting to words or photographs is not consent to send a voice", async () => {
    writeServerConfig({
      auth: { enabled: true },
      credits: { enabled: true },
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
      credits: { enabled: true },
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

describe("the ledger", () => {
  beforeEach(async () => {
    await consent();
  });

  test("a twelve-second recording costs four hundredths of a credit", async () => {
    const done = await read(await call());
    expect(done.body.spent).toBe(0.04);
    expect(await balanceOf("alex")).toBe(9.96);
  });

  test("a six-minute recording costs a credit and a fifth", async () => {
    const done = await read(await call({ seconds: 361 }));
    expect(done.body.spent).toBe(1.21);
    expect(await balanceOf("alex")).toBe(8.79);
  });

  test("a retry under one idempotency key charges once", async () => {
    const first = await read(await call());
    const again = await read(await call());
    expect(again.body).toEqual(first.body);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(await balanceOf("alex")).toBe(9.96);
  });

  test("a failed provider call gives the credit back", async () => {
    transcribeAudio.mockRejectedValueOnce(new Error("deepgram is unhappy"));
    const failed = await read(await call());
    expect(failed.status).toBe(502);
    expect(await balanceOf("alex")).toBe(10);
  });

  test("a longer recording than was claimed is charged for what the provider measured", async () => {
    transcribeAudio.mockResolvedValueOnce({ text: "A long one.", seconds: 700 });
    const done = await read(await call({ seconds: 2 }));
    // 700s at five minutes to the credit, rounded up to the hundredth.
    expect(done.body.spent).toBe(2.34);
    expect(await balanceOf("alex")).toBe(7.66);
  });

  test("a recording longer than the ceiling is refused before any spend", async () => {
    const refused = await read(await call({ seconds: 1200 }));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("recording_too_long");
    expect(await balanceOf("alex")).toBe(10);
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
      credits: { enabled: true },
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

describe("with the capability off", () => {
  test("the route answers 404 rather than failing", async () => {
    writeServerConfig({ auth: { enabled: true }, credits: { enabled: true } });
    const refused = await read(await call());
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("transcription_unavailable");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  test("it will not come on while credits are off, the way the helper will not", async () => {
    writeServerConfig({
      auth: { enabled: true },
      transcription: { enabled: true, backend: "dry-run" },
    });
    const refused = await read(await call());
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("transcription_unavailable");
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
