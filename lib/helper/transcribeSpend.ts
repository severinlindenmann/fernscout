import "server-only";
import { mayUseAi } from "@paid/billing/lib/aiDays";
import { MAX_SPEECH_SECONDS } from "./speech";
import type { SpeechLanguage } from "./speech";
import { transcribeAudio } from "./transcribe";
import type { UncertainWord } from "./transcribe";

/**
 * The whole money path around one transcription — spend, call, refund on
 * failure, reconcile to what was actually measured — extracted from
 * `app/api/helper/[user]/transcribe/route.ts` (B686) so a second door
 * (WhatsApp, B1060) calls the same four steps rather than growing its own
 * copy of them.
 *
 * **Why this matters more than the usual "don't repeat yourself":** the
 * route's own reconciliation step (charging more when Deepgram measured a
 * longer recording than the caller claimed) is exactly the step a hand-copied
 * version would be most likely to leave out, and it is real money either way.
 * One function, one set of rules, both doors.
 *
 * Its own file rather than living beside `transcribeAudio` in
 * `./transcribe.ts` — `transcribeAudio` is what
 * `test/helper-transcribe.test.ts` stubs to keep the provider off the network
 * (the same discipline every model-touching test here follows), and a
 * function calling it from *inside the same module* would call the real one
 * regardless of that stub: `vi.mock`'s replacement is a thing other modules'
 * imports see, not a thing a module's own internal calls consult. Being a
 * separate importer is what makes the stub actually reach this.
 */

/** What this refused, or what it produced. */
export type TranscribeOutcome =
  | { ok: true; text: string; seconds: number; uncertainWord?: UncertainWord }
  | { ok: false; error: "plan_limit" | "transcription_failed" | "recording_too_long" };

/**
 * B2591 — transcription takes no AI day of its own; it needs an active plan
 * or unused Free days, checked once before the call, and nothing is spent or
 * refunded any more.
 */
export async function spendAndTranscribe(
  username: string,
  audio: Buffer,
  mediaType: string,
  language: SpeechLanguage,
  claimedSeconds: number,
  /** The staging run this recording was made inside, when there is one —
   *  kept for callers that still pass it; nothing here reads it any more
   *  now that there is no ledger ref to key it into. */
  runId?: string,
  /** The trip's own keyterms (`lib/helper/keyterms.ts`), when the caller
   *  knows which trip this recording belongs to — B2691. */
  keyterms: string[] = [],
): Promise<TranscribeOutcome> {
  void runId;
  void claimedSeconds;
  const gate = await mayUseAi(username);
  if (!gate.ok) return { ok: false, error: "plan_limit" };

  let transcript;
  try {
    transcript = await transcribeAudio(audio, mediaType, language, username, keyterms);
  } catch {
    return { ok: false, error: "transcription_failed" };
  }

  // A caller can claim anything — 0, a negative number, nothing at all — and
  // the only thing that has actually measured the recording is Deepgram's own
  // answer. So the ceiling this instance promised (B686's `MAX_SPEECH_SECONDS`)
  // applies to what was *measured*, not only to what was claimed, and a
  // recording past it is refused here too.
  if (transcript.seconds > MAX_SPEECH_SECONDS) {
    return { ok: false, error: "recording_too_long" };
  }

  return {
    ok: true,
    text: transcript.text,
    seconds: transcript.seconds,
    uncertainWord: transcript.uncertainWord,
  };
}
