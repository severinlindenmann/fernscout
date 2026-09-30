import "server-only";
import { mayUseAi } from "@paid/credits/lib/aiDays";
import { creditsForSeconds, MAX_SPEECH_SECONDS } from "./speech";
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
  | { ok: true; text: string; seconds: number; spent: number; uncertainWord?: UncertainWord }
  | { ok: false; error: "plan_limit" | "transcription_failed" | "recording_too_long"; cost: number };

/**
 * B2591 — transcription takes no AI day of its own; it needs an active plan
 * or unused Free days, checked once before the call, and nothing is spent or
 * refunded any more. `spent` on a success is kept, at `0`, purely so callers
 * that still read it (the route, the WhatsApp door) do not need a second
 * shape — it is never charged.
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
): Promise<TranscribeOutcome> {
  void runId;
  const credits = creditsForSeconds(claimedSeconds);
  const gate = await mayUseAi(username);
  if (!gate.ok) return { ok: false, error: "plan_limit", cost: credits };

  let transcript;
  try {
    transcript = await transcribeAudio(audio, mediaType, language, username);
  } catch {
    return { ok: false, error: "transcription_failed", cost: credits };
  }

  // A caller can claim anything — 0, a negative number, nothing at all — and
  // the only thing that has actually measured the recording is Deepgram's own
  // answer. So the ceiling this instance promised (B686's `MAX_SPEECH_SECONDS`)
  // applies to what was *measured*, not only to what was claimed, and a
  // recording past it is refused here too.
  if (transcript.seconds > MAX_SPEECH_SECONDS) {
    return { ok: false, error: "recording_too_long", cost: credits };
  }

  return {
    ok: true,
    text: transcript.text,
    seconds: transcript.seconds,
    spent: 0,
    uncertainWord: transcript.uncertainWord,
  };
}
