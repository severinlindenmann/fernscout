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
 * That is the whole of what this server guarantees. What happens at the
 * provider is a separate, weaker claim: the request carries
 * `mip_opt_out=true`, which *asks* Deepgram not to retain the audio for model
 * improvement. It is a request honoured by their policy, not a mechanism this
 * code can verify — B1076.
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

/**
 * `dry-run`'s own canned "uncertain word" — B1803 Task 3.4.
 *
 * The check-the-wording screen (S7b) needs *something* to highlight in
 * local development, where there is no real Deepgram confidence to read.
 * This is not a second fiction bolted onto the first: `DRY_RUN_TRANSCRIPT`
 * above is already an explicitly-labelled fake sentence nobody spoke, and
 * flagging one of its own words as "uncertain" stays inside that same,
 * already-declared fake — it is not a real transcript wearing a fake
 * confidence score.
 */
const DRY_RUN_UNCERTAIN_WORD = "machine";

/** `DRY_RUN_UNCERTAIN_WORD` appears exactly once in `DRY_RUN_TRANSCRIPT`, so
 *  it is always the first (and only) occurrence. */
const DRY_RUN_UNCERTAIN_OCCURRENCE = 0;

/**
 * The line below which a word is shown to the person rather than trusted —
 * B1803 Task 3.4. Deepgram's own confidence for a correctly heard common
 * word is almost always well above 0.85; the words that actually slip
 * (names, places, anything rare) tend to land in the 0.3–0.6 band the
 * design's own example ("Ban Mi Fuong") is drawn from. 0.6 catches that
 * band without flagging the ordinary, slightly-uncertain word every
 * recording has a few of — a lower bar would turn this into background
 * noise nobody reads, which is worse than not asking at all.
 */
export const UNCERTAIN_WORD_CONFIDENCE = 0.6;

type DeepgramWord = { word: string; punctuated_word?: string; confidence?: number };

/** The one word `leastConfidentWord` flagged, plus which occurrence of it
 *  this is in the provider's own word order — B1803 Task 3b fix round 2.
 *  `occurrence` is how many earlier words in the *provider's* `words[]`
 *  carried this exact (punctuated) text — 0 for the first, 1 for the
 *  second, and so on — so a screen locating this word inside the plain
 *  transcript string can pick the right occurrence when the word repeats,
 *  rather than always landing on the first. */
export type UncertainWord = { word: string; occurrence: number };

/**
 * The one word most worth a second look, or nothing — B1803 Task 3.4.
 *
 * Never a guess: this only ever names a word the provider itself measured
 * low confidence on, and only the single lowest one, matching the design's
 * own "one word looked uncertain" (singular). No `words` at all — an older
 * response shape, a provider that does not return them — is answered with
 * `undefined`, the same as every word clearing the bar: silence, not a
 * guess dressed up as one.
 *
 * Also carries `occurrence` (fix round 2): a transcript can say the same
 * word twice, and confidence is measured per *token*, not per distinct
 * spelling — flagging only the text let `CheckWording`'s `splitOnWord`
 * highlight whichever occurrence came first in the string, which is not
 * necessarily the one Deepgram was actually unsure about.
 */
export function leastConfidentWord(words: DeepgramWord[] | undefined): UncertainWord | undefined {
  if (!words || words.length === 0) return undefined;
  let worst: DeepgramWord | undefined;
  let worstIndex = -1;
  words.forEach((word, index) => {
    if (typeof word.confidence !== "number") return;
    if (!worst || word.confidence < (worst.confidence ?? 1)) {
      worst = word;
      worstIndex = index;
    }
  });
  if (!worst || (worst.confidence ?? 1) >= UNCERTAIN_WORD_CONFIDENCE) return undefined;
  const flagged = worst.punctuated_word ?? worst.word;
  let occurrence = 0;
  for (let i = 0; i < worstIndex; i++) {
    const earlier = words[i];
    if ((earlier.punctuated_word ?? earlier.word) === flagged) occurrence++;
  }
  return { word: flagged, occurrence };
}

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
  /** What `leastConfidentWord` flagged — the word, in the same form it
   *  appears in `text`, and which occurrence of it this is (fix round 2,
   *  for a word the transcript says more than once) — or absent, which the
   *  check-the-wording screen (S7b) shows as a plain transcript with no
   *  highlight and no "one word looked uncertain" panel. Never invented:
   *  this is either what the provider measured or nothing at all. */
  uncertainWord?: UncertainWord;
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
    return {
      text: DRY_RUN_TRANSCRIPT,
      seconds: 0,
      uncertainWord: { word: DRY_RUN_UNCERTAIN_WORD, occurrence: DRY_RUN_UNCERTAIN_OCCURRENCE },
    };
  }

  const url = new URL(DEEPGRAM_URL);
  url.searchParams.set("model", DEEPGRAM_MODEL);
  // Explicit, always. See ./speech.ts: `multi` covers ten languages and two of
  // the four this feature exists for are not among them.
  url.searchParams.set("language", language);
  url.searchParams.set("smart_format", "true");
  // Ask the provider not to retain this audio for model training — B1076.
  url.searchParams.set("mip_opt_out", "true");

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
    results?: {
      channels?: { alternatives?: { transcript?: string; words?: DeepgramWord[] }[] }[];
    };
  };
  const alternative = body.results?.channels?.[0]?.alternatives?.[0];
  const text = alternative?.transcript;
  if (typeof text !== "string") throw new Error("deepgram: no transcript in the answer");
  const seconds = typeof body.metadata?.duration === "number" ? body.metadata.duration : 0;
  const uncertainWord = leastConfidentWord(alternative?.words);

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

  return { text: text.trim(), seconds, uncertainWord };
}
