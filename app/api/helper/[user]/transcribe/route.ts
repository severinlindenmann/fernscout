import { isEnabled } from "@/lib/capabilities";
import { refund, spend } from "@/lib/credits";
import { hasHelperConsent } from "@/lib/helper/consent";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import {
  creditsForSeconds,
  MAX_AUDIO_BYTES,
  MAX_SPEECH_SECONDS,
  SPEECH_LANGUAGES,
  speechLanguageFor,
} from "@/lib/helper/speech";
import { speechProvider, transcribeAudio } from "@/lib/helper/transcribe";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { defaultLocaleFor } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * A recording in, words out, and the recording gone — B686.
 *
 * The same shape as `day/write-day` and `day/describe-photos`, and the same
 * gate order for the same reasons: owner (cookie only, bearer refused), the
 * capability, the rate limit, consent, idempotency, the spend, and only then
 * the provider — each gate cheaper than the next, so the expensive one is the
 * only one that can fail after money has moved.
 *
 * **Nothing is written to disk, at any point.** The bytes live in this
 * request and die with it: no file under `contentRoot()`, none under
 * `dataDir()`, no temporary anywhere. What the person asked for is the
 * transcript, which is returned and goes into their draft if they keep it;
 * a saved copy of somebody's voice is a thing nobody agreed to.
 *
 * **The language is passed explicitly and is never detected.** It comes from
 * the journal, with the reader's own UI language as a fallback and an override
 * on the button — `lib/helper/speech.ts` sets out why automatic detection is
 * the one choice that fails silently for half the languages this exists for.
 */

/** Fifteen minutes, and more holds than a person on a bus makes. A brake on a
 *  script; the credit is the quota. */
const LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };

/** What a browser's `MediaRecorder` actually produces, plus what a phone
 *  might. Anything else is refused before a byte is sent anywhere. */
const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/transcribe">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("transcription", user)) {
    return Response.json({ error: "transcription_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-transcribe", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  // The media type is checked before the bytes are decoded, and the bytes
  // before anything is charged for them.
  const mediaType = text(body.mediaType).split(";")[0].toLowerCase();
  if (!AUDIO_TYPES.includes(mediaType)) {
    return Response.json({ error: "unsupported_audio", accepted: AUDIO_TYPES }, { status: 400 });
  }
  const audio = Buffer.from(text(body.audio), "base64");
  if (audio.byteLength === 0) return Response.json({ error: "no_audio" }, { status: 400 });
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return Response.json({ error: "audio_too_large", maxBytes: MAX_AUDIO_BYTES }, { status: 413 });
  }

  const claimed = typeof body.seconds === "number" && Number.isFinite(body.seconds) ? body.seconds : 0;
  if (claimed > MAX_SPEECH_SECONDS) {
    return Response.json(
      { error: "recording_too_long", maxSeconds: MAX_SPEECH_SECONDS },
      { status: 400 },
    );
  }

  const language = speechLanguageFor(text(body.language), defaultLocaleFor(user), text(body.locale));
  if (!language) {
    return Response.json(
      { error: "unsupported_language", supported: [...SPEECH_LANGUAGES] },
      { status: 400 },
    );
  }

  // A voice is neither the words somebody typed nor their photographs, and it
  // goes to a different company than either — so consent to those is not
  // consent to this. B687's split, extended in B686.
  if (!hasHelperConsent(user, "speech")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const supplied = text(body.idempotency_key);
  const key = supplied === "" ? null : idempotencyKey(user, "helper.transcribe", supplied);
  // The audio's own length and bytes, not the recording itself: a fingerprint
  // is held in memory and this one must not be a copy of somebody's voice.
  const fingerprint = fingerprintOf({ bytes: audio.byteLength, language, seconds: claimed });
  const recalled = await recall<Record<string, unknown>>(key, fingerprint);
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  const credits = creditsForSeconds(claimed);
  const ledgerRef = `${user}/speech/${Math.ceil(claimed)}s`;
  if (!(await spend(user, credits, "transcription", ledgerRef))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  let transcript;
  try {
    transcript = await transcribeAudio(audio, mediaType, language, user);
  } catch {
    // The credit bought nothing, so it goes back. What a provider says when it
    // is unhappy is not something to render on somebody's phone.
    await refund(user, credits, ledgerRef);
    return Response.json({ error: "transcription_failed" }, { status: 502 });
  }

  // What the provider measured beats what the caller claimed, when it is
  // longer: the seconds on the button are a stopwatch in a browser, and a
  // caller could simply say "one" for ten minutes of audio. Charged after the
  // fact because the duration is not knowable before the call; a top-up that
  // cannot be paid is logged by the ledger's absence and not worth failing a
  // transcript the person already has.
  let spent = credits;
  const measured = creditsForSeconds(transcript.seconds);
  if (transcript.seconds > 0 && measured > credits) {
    if (await spend(user, measured - credits, "transcription", ledgerRef)) spent = measured;
  }

  const answer = {
    ok: true,
    text: transcript.text,
    language,
    spent,
    provider: speechProvider(),
  };
  await remember(key, fingerprint, answer);
  return Response.json(answer);
}
