import "server-only";
import { refund, spend } from "../credits";
import { creditsForSeconds, MAX_SPEECH_SECONDS } from "./speech";
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
  | { ok: false; error: "no_credits" | "transcription_failed" | "recording_too_long"; cost: number };

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

  // A caller can claim anything — 0, a negative number, nothing at all — and
  // the only thing that has actually measured the recording is Deepgram's own
  // answer. So the ceiling this instance promised (B686's `MAX_SPEECH_SECONDS`)
  // applies to what was *measured*, not only to what was claimed, and a
  // recording past it is refused here too rather than paid for and returned.
  if (transcript.seconds > MAX_SPEECH_SECONDS) {
    await refund(username, credits, ledgerRef);
    return { ok: false, error: "recording_too_long", cost: credits };
  }

  // What the provider measured beats what the caller claimed, when it is
  // longer — see app/api/helper/[user]/transcribe/route.ts's own comment on
  // this, word for word the same reasoning. This is where the whole thing was
  // failing open: a caller who claims 0 seconds is pre-charged only the floor,
  // and when the top-up for what Deepgram actually measured cannot be
  // afforded, the old code quietly kept the floor charge and handed back the
  // full transcript anyway — the operator ate the rest of the Deepgram bill.
  // Fail closed instead: no top-up, no transcript, and the floor itself comes
  // back so nobody is left charged for words they never received.
  let spent = credits;
  const measured = creditsForSeconds(transcript.seconds);
  if (transcript.seconds > 0 && measured > credits) {
    const topUpOk = await spend(username, measured - credits, "transcription", ledgerRef);
    if (!topUpOk) {
      await refund(username, credits, ledgerRef);
      return { ok: false, error: "no_credits", cost: measured };
    }
    spent = measured;
  }

  return { ok: true, text: transcript.text, seconds: transcript.seconds, spent };
}
