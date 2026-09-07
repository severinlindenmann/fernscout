import "server-only";
import { loadServerConfig } from "../config";
import { recordUsage } from "../usage";
import type { SpeechLanguage } from "./speech";

/**
 * Speech into text, and then the audio is gone — B686.
 *
 * **Nothing here writes a file.** The bytes arrive in a request, go to a
 * provider (or nowhere at all, on `dry-run`), and are dropped with the
 * request. Nothing lands under `contentRoot()` or `dataDir()`: a voice
 * recording is the most personal thing this product has ever been handed, the
 * transcript is the part somebody asked for, and a copy of the audio would be
 * a copy nobody remembers agreeing to. `test/helper-transcribe.test.ts`
 * asserts the disk is untouched.
 *
 * Two backends, chosen in `site/config.json`:
 *
 * - **`dry-run`** returns a canned transcript and talks to nobody. It is what
 *   the tests and local development use, and it is not a nicety: AGENTS.md
 *   says no feature may need a paid account to develop or test, and mail and
 *   every print provider already keep that promise the same way.
 * - **`deepgram`** is the real one. Pre-recorded, Nova-3, and the language
 *   **passed explicitly** — never `multi`, for the reason `./speech.ts` sets
 *   out at length.
 *
 * The key is environment-only and never `site/config.json`, like every other
 * bearer credential that spends the operator's money.
 */

const DEEPGRAM_MODEL = "nova-3";

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

/** What `dry-run` says, in every language. Deliberately unmistakable: a
 *  transcript nobody spoke must not read like one somebody did. */
export const DRY_RUN_TRANSCRIPT =
  "This is a dry-run transcript. No audio left this machine and nothing was written down.";

/** @public Exported only for `test/helper-transcribe.test.ts`, which reaches
 * it through `vi.importActual` — a dynamic specifier knip cannot trace, so
 * the export would otherwise read as unused. B235. */
export function speechBackend(): string {
  const configured = loadServerConfig().features.transcription.backend;
  return typeof configured === "string" ? configured : "dry-run";
}

/** Who the voice is going to, said in the consent panel. */
export function speechProvider(): string {
  return speechBackend() === "deepgram" ? "Deepgram" : "dry-run";
}

export type Transcript = {
  text: string;
  /** What the provider measured, or 0 when nobody measured anything. The
   *  route reconciles the charge against it, so a caller under-reporting its
   *  own minutes is charged for the ones it actually used. */
  seconds: number;
};

/**
 * One request, one transcript. Throws on anything that goes wrong — the
 * caller has already spent by the time this runs and refunds on a throw, the
 * same contract `writeDay` has.
 */
export async function transcribeAudio(
  audio: Buffer,
  mediaType: string,
  language: SpeechLanguage,
  owner?: string,
): Promise<Transcript> {
  if (speechBackend() !== "deepgram") {
    return { text: DRY_RUN_TRANSCRIPT, seconds: 0 };
  }

  const url = new URL(DEEPGRAM_URL);
  url.searchParams.set("model", DEEPGRAM_MODEL);
  // Explicit, always. See ./speech.ts: `multi` covers ten languages and two of
  // the four this feature exists for are not among them.
  url.searchParams.set("language", language);
  url.searchParams.set("smart_format", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Token ${process.env.DEEPGRAM_API_KEY ?? ""}`,
      "content-type": mediaType,
    },
    body: new Uint8Array(audio),
  });
  if (!response.ok) throw new Error(`deepgram: ${response.status}`);

  const body = (await response.json()) as {
    metadata?: { duration?: number };
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const text = body.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof text !== "string") throw new Error("deepgram: no transcript in the answer");
  const seconds = typeof body.metadata?.duration === "number" ? body.metadata.duration : 0;

  // What the instance was billed — B746. Deepgram's own measured duration, not
  // the caller's claim, for the same reason the route reconciles the charge
  // against it. `recordUsage` never throws; the transcript survives whatever
  // this does. Only on the real backend: dry-run talks to nobody and is billed
  // for nothing.
  if (owner) {
    await recordUsage({
      owner,
      provider: "deepgram",
      model: DEEPGRAM_MODEL,
      operation: "transcribe",
      seconds,
    });
  }

  return { text: text.trim(), seconds };
}
