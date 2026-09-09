import "server-only";
import { refund, spend } from "../credits";
import { creditsForSeconds } from "./speech";
import type { SpeechLanguage } from "./speech";
import { transcribeAudio } from "./transcribe";

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
  | { ok: true; text: string; seconds: number; spent: number }
  | { ok: false; error: "no_credits" | "transcription_failed"; cost: number };

export async function spendAndTranscribe(
  username: string,
  audio: Buffer,
  mediaType: string,
  language: SpeechLanguage,
  claimedSeconds: number,
): Promise<TranscribeOutcome> {
  const credits = creditsForSeconds(claimedSeconds);
  const ledgerRef = `${username}/speech/${Math.ceil(claimedSeconds)}s`;
  if (!(await spend(username, credits, "transcription", ledgerRef))) {
    return { ok: false, error: "no_credits", cost: credits };
  }

  let transcript;
  try {
    transcript = await transcribeAudio(audio, mediaType, language, username);
  } catch {
    await refund(username, credits, ledgerRef);
    return { ok: false, error: "transcription_failed", cost: credits };
  }

  // What the provider measured beats what the caller claimed, when it is
  // longer — see app/api/helper/[user]/transcribe/route.ts's own comment on
  // this, word for word the same reasoning.
  let spent = credits;
  const measured = creditsForSeconds(transcript.seconds);
  if (transcript.seconds > 0 && measured > credits) {
    if (await spend(username, measured - credits, "transcription", ledgerRef)) spent = measured;
  }

  return { ok: true, text: transcript.text, seconds: transcript.seconds, spent };
}
