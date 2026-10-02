import { isEnabled } from "@/lib/capabilities";
import { checkAiDay, recordAiDay } from "@paid/billing/lib/aiDays";
import { buildDayContext, renderDayPack } from "@/lib/helper/dayContext";
import { ComposeRejected, composeDay } from "@/lib/helper/compose";
import { tagsUsedBefore } from "@/lib/studio/tagsUsedBefore";
import { hasHelperConsent } from "@/lib/helper/consent";
import {
  HELPER_PROVIDER,
  suggestTitles,
  tagDay,
  translateDay,
  writeDay,
  type DayFacts,
  type PhotoImage,
  type WriteDayMode,
} from "@/lib/helper/model";
import { checkPolishForAddedFacts, keepTypedWhereAccentsGuessed, titleIsGroundedInNotes } from "@/lib/helper/polishGuard";
import { DESCRIBE_PHOTO_WIDTH, WRITE_DAY_FACT_MAX_CHARS, WRITE_DAY_NOTES_MAX_CHARS, WRITE_DAY_TITLE_MAX_CHARS } from "@/lib/helper/limits";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { note, refused } from "@/lib/helper/thread";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { resizedCopy, resolveMediaFile } from "@/lib/media";
import { defaultLocaleFor, localesFor } from "@/lib/locales";
import { mediaKey } from "@/lib/photos";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { readJsonBody } from "@/lib/api/jsonBody";
import { parseWeather, weatherFactLine } from "@/lib/weather";

export const dynamic = "force-dynamic";

/**
 * Notes in, a draft to read back — B684.
 *
 * **Nothing here writes anything to disk.** It returns the model's answer and
 * stops; the person reads it, and either keeps it (which is the existing
 * `PATCH` on the day, the same call their own typing goes through) or throws
 * it away and keeps their own words. That is the plan's rule that returned
 * prose is always shown for review, and it is what makes the invention rule in
 * `lib/helper/model.ts` enforceable rather than merely stated.
 *
 * Cookie only and bearer refused, like every route in this family — see
 * `isHelperOwner`. The capability being off is a 404 rather than a 500: the
 * button is not on the page at all in that case, so anything arriving here is
 * somebody who went looking.
 *
 * The order of the four gates below is deliberate. Rate limit, then consent,
 * then the AI day, then the model: each one is cheaper than the next, and the
 * expensive one is the only one that can fail after money has moved — which is
 * what the refund is for.
 */

/** Fifteen minutes, and comfortably more write-ups than a person on a bus
 *  makes. It is a brake on a script, not a quota; the AI day is the quota. */
const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Day tags, the schema's own shape (`DAY_DECLINABLE_KEYS`'s `tags`,
 *  `lib/api/v2/schemas/day.ts`): lowercase, hyphenated, at most 30
 *  characters. Never trusted from the model on its own say-so — B2675. */
const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TAG_MAX_COUNT = 6;
const TAG_MAX_CHARS = 30;
/** More than a day's gallery realistically needs for a tag suggestion. */
const TAG_PHOTO_MAX = 6;

function slugifyTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAG_MAX_CHARS)
    .replace(/-+$/g, "");
}

/** Slugified, deduplicated, capped — the model's raw suggestions validated
 *  the same "grounded, then checked" way `suggestTitles`'s titles are. */
function tagsFrom(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of raw) {
    const slug = slugifyTag(candidate);
    if (slug === "" || !TAG_RE.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= TAG_MAX_COUNT) break;
  }
  return out;
}

/** Each photo id resolved and resized the same way `describe-photos`
 *  resolves one — a file that will not resolve or resize is quietly
 *  dropped rather than failing the whole request over one picture. */
async function resolvePhotoImages(user: string, photoIds: string[]): Promise<PhotoImage[]> {
  const images: PhotoImage[] = [];
  for (const photoId of photoIds.slice(0, TAG_PHOTO_MAX)) {
    const segments = mediaKey(photoId).split("/");
    const file = resolveMediaFile(user, segments);
    if (!file) continue;
    const resized = await resizedCopy(file, DESCRIBE_PHOTO_WIDTH);
    if (!resized) continue;
    images.push({ base64: resized.toString("base64"), mediaType: "image/webp" });
  }
  return images;
}

const ANSWERS_MAX = 3;
const ANSWER_MAX_CHARS = 500;
const EXISTING_TAGS_MAX = 40;

/**
 * `mode: "compose"` — B2688. `{trip, slug, answers?}` in; the day's facts
 * come from `buildDayContext` here on the server, never from the client.
 * Same gates in the same order as every other mode (rate limit above, then
 * cheap input checks, consent, idempotency, the AI day, the model), and the
 * same refund rule: an AI day is recorded only once a variant survived its
 * guards (`lib/helper/composeGuard.ts`).
 *
 * Consent is `words` only. No photograph leaves the machine here: what the
 * pack carries about a picture is its already-written description text and
 * the owner's own caption — words the `photos` consent already covered when
 * the description was made.
 */
async function compose(user: string, tripId: string, body: Record<string, unknown>): Promise<Response> {
  const slug = text(body.slug);
  if (slug === "") {
    refused(user, "draft_words", "no_slug");
    return Response.json({ error: "no_slug", message: "compose needs the day's slug." }, { status: 400 });
  }
  const rawAnswers = body.answers ?? [];
  if (
    !Array.isArray(rawAnswers) ||
    rawAnswers.length > ANSWERS_MAX ||
    rawAnswers.some((a) => typeof a !== "string" || a.length > ANSWER_MAX_CHARS)
  ) {
    refused(user, "draft_words", "invalid_answers");
    return Response.json(
      {
        error: "invalid_answers",
        message: `answers is at most ${ANSWERS_MAX} strings of at most ${ANSWER_MAX_CHARS} characters each.`,
        maxCount: ANSWERS_MAX,
        maxChars: ANSWER_MAX_CHARS,
      },
      { status: 400 },
    );
  }
  const answers = (rawAnswers as string[]).map((a) => a.trim()).filter((a) => a !== "");

  const pack = buildDayContext(user, tripId, slug, { voiceSamples: 2 });
  if (!pack) {
    refused(user, "draft_words", "unknown_day");
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }
  const words = [...pack.notes.map((n) => n.text), ...answers].join(" ");
  if (words.trim() === "" && pack.photos.length === 0) {
    refused(user, "draft_words", "no_notes");
    return Response.json({ error: "no_notes" }, { status: 400 });
  }
  // B2223 — the same input ceiling as the other modes, measured on what
  // the server itself would send.
  if (words.length > WRITE_DAY_NOTES_MAX_CHARS) {
    refused(user, "draft_words", "notes_too_long");
    return Response.json(
      {
        error: "notes_too_long",
        message: `Notes can be at most ${WRITE_DAY_NOTES_MAX_CHARS} characters; these are ${words.length}.`,
        maxChars: WRITE_DAY_NOTES_MAX_CHARS,
      },
      { status: 413 },
    );
  }

  if (!hasHelperConsent(user, "words")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const supplied = text(body.idempotency_key);
  const key = supplied === "" ? null : idempotencyKey(user, "helper.write-day", supplied);
  // The pack is in the fingerprint: the same key after the day's words
  // changed is a different call, not a replay of the old answer.
  const fingerprint = fingerprintOf({ mode: "compose", tripId, slug, answers, pack: renderDayPack(pack) });
  const recalled = await recall<Record<string, unknown>>(key, fingerprint);
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  const gate = await checkAiDay(user, tripId, pack.date);
  if (!gate.ok) {
    refused(user, "draft_words", "plan_limit");
    return Response.json(gate.refusal, { status: 402 });
  }

  let composed;
  try {
    composed = await composeDay(pack, {
      answers,
      existingTags: tagsUsedBefore(user).slice(0, EXISTING_TAGS_MAX),
      owner: user,
    });
  } catch (error) {
    if (error instanceof ComposeRejected) {
      refused(user, "draft_words", "compose_rejected");
      return Response.json({ error: "compose_rejected", dropped: error.reasons }, { status: 422 });
    }
    refused(user, "draft_words", "model_failed");
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
  await recordAiDay(user, tripId, pack.date);

  const answer = {
    ok: true,
    language: composed.language,
    close: composed.close,
    story: composed.story,
    tags: tagsFrom(composed.tags),
    missing: composed.missing,
    dropped: composed.dropped,
    aiDay: pack.date,
    provider: HELPER_PROVIDER,
  };
  await remember(key, fingerprint, answer);
  return Response.json(answer);
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/write-day">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-write", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip);
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) {
    refused(user, "draft_words", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  if (text(body.mode) === "compose") return compose(user, tripId, body);

  // `polish` (B2190) reworks the owner's own already-written text; `titles`
  // (TIX-2) suggests up to two short titles from the notes alone;
  // `translate`/`tags` (B2675) work from the day's own already-written
  // `content` rather than rough `notes` — resolved here, before the field is
  // even read, so every mode below reads one variable (`notes`) from
  // whichever body field is actually its own. Anything else — including no
  // field at all, which is every existing caller, WhatsApp's `draft_words`
  // included — keeps the original `draft` behaviour.
  const modeField = text(body.mode);
  const mode: WriteDayMode =
    modeField === "polish"
      ? "polish"
      : modeField === "titles"
        ? "titles"
        : modeField === "translate"
          ? "translate"
          : modeField === "tags"
            ? "tags"
            : "draft";
  const usesContentField = mode === "translate" || mode === "tags";
  const photoIds = Array.isArray(body.photoIds) ? body.photoIds.filter((p): p is string => typeof p === "string") : [];

  const notes = usesContentField ? text(body.content) : text(body.notes);
  // `tags` may work from photographs alone — B2675 — so an empty `content`
  // is refused only when there is nothing else to tag from either.
  if (notes === "" && !(mode === "tags" && photoIds.length > 0)) {
    refused(user, "draft_words", usesContentField ? "no_content" : "no_notes");
    return Response.json({ error: usesContentField ? "no_content" : "no_notes" }, { status: 400 });
  }
  // B2223 — a flat cost to the operator per input token needs a ceiling.
  // Both modes, before consent and before the AI-day gate.
  if (notes.length > WRITE_DAY_NOTES_MAX_CHARS) {
    refused(user, "draft_words", "notes_too_long");
    return Response.json(
      {
        error: "notes_too_long",
        message: `Notes can be at most ${WRITE_DAY_NOTES_MAX_CHARS} characters; these are ${notes.length}.`,
        maxChars: WRITE_DAY_NOTES_MAX_CHARS,
      },
      { status: 413 },
    );
  }
  // B2223 review F2: the facts go into the prompt beside the notes, so they
  // are bounded too, and also before the AI-day gate. `date` is optional
  // (the polish link sends none), but when it is sent it has to be a date.
  const date = text(body.date);
  if (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    refused(user, "draft_words", "invalid_date");
    return Response.json({ error: "invalid_date", message: "date must be YYYY-MM-DD." }, { status: 400 });
  }
  for (const field of ["location", "country", "from", "to"] as const) {
    const value = text(body[field]);
    if (value.length > WRITE_DAY_FACT_MAX_CHARS) {
      refused(user, "draft_words", "fact_too_long");
      return Response.json(
        {
          error: "fact_too_long",
          message: `${field} can be at most ${WRITE_DAY_FACT_MAX_CHARS} characters; this one is ${value.length}.`,
          field,
          maxChars: WRITE_DAY_FACT_MAX_CHARS,
        },
        { status: 413 },
      );
    }
  }
  // Security review follow-up — `translate`'s own `title` is never run
  // through the `["location", "country", "from", "to"]` loop above (it is
  // not one of those fields), so without its own check a body could carry
  // an unbounded `title` straight into the prompt. Capped the same way,
  // before consent and before the AI-day gate.
  if (mode === "translate") {
    const title = text(body.title);
    if (title.length > WRITE_DAY_TITLE_MAX_CHARS) {
      refused(user, "draft_words", "title_too_long");
      return Response.json(
        {
          error: "title_too_long",
          message: `title can be at most ${WRITE_DAY_TITLE_MAX_CHARS} characters; this one is ${title.length}.`,
          maxChars: WRITE_DAY_TITLE_MAX_CHARS,
        },
        { status: 413 },
      );
    }
  }

  // B2675 — the target language, `translate` mode only, checked before
  // consent and before the AI-day gate like every other cheap input check
  // above: a model has no way to know what a journal declares, so this is
  // the route's own job. Never the journal's own language (`defaultLocale`
  // — the language a day's own title/content is already written in, the
  // same reading `exemptSingleLocaleTranslations` gives it, lib/api/v2/write.ts)
  // and always one `user.locales` actually lists.
  const toLocale = mode === "translate" ? text(body.to) : "";
  if (mode === "translate") {
    const locales = localesFor(user);
    const own = defaultLocaleFor(user);
    if (toLocale === "" || toLocale === own || !locales.includes(toLocale)) {
      refused(user, "draft_words", "invalid_locale");
      return Response.json(
        {
          error: "invalid_locale",
          message:
            toLocale === own
              ? `"${toLocale}" is this journal's own language — there is nothing to translate it into.`
              : `"${toLocale}" is not one of this journal's own languages (${locales.join(", ")}).`,
          locales: locales.filter((l) => l !== own),
        },
        { status: 400 },
      );
    }
  }

  // Before the first model call ever made for this journal, and before the
  // AI-day gate — a day taken for a call that consent would have refused
  // is a day taken for nothing. Not recorded as a press refusal: consent, like the
  // capability switch above, is a gate on whether the wizard may speak to a
  // model at all, not a press failing on what it asked for.
  if (!hasHelperConsent(user, "words")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }
  // B2675 — `tags` sends photographs only when it was actually given some,
  // so only then is it the bigger promise B687 split `photos` out for.
  if (mode === "tags" && photoIds.length > 0 && !hasHelperConsent(user, "photos")) {
    return Response.json({ error: "consent_required", scope: "photos" }, { status: 403 });
  }

  // B2687 — when the client names the day it is writing about, the facts
  // that are *measured* (place, weather, photo span) come from the day
  // itself rather than from whatever the client happened to send. A client
  // is still trusted for `location`/`country`/`from`/`to`/`photos` when no
  // `slug` is given at all (every caller before this ticket), and for
  // anything `buildDayContext` itself has nothing to say about — a draft's
  // place before it has one, say.
  const slug = text(body.slug);
  const pack = slug !== "" ? buildDayContext(user, tripId, slug) : null;
  const weatherFact = pack?.facts.find((f) => f.id === "weather");
  const location = pack?.place?.location || text(body.location);
  const country = pack?.place?.country || text(body.country);
  const from = pack?.photoSpanRaw?.from || text(body.from);
  const to = !usesContentField ? pack?.photoSpanRaw?.to || text(body.to) : "";
  const photos = pack?.photoSpanRaw?.count ?? (typeof body.photos === "number" ? body.photos : undefined);
  // B2684 — the day's own measured weather, when the caller sends it. Run
  // through `parseWeather`, the same validator a stored day's own weather is
  // checked against, rather than trusted as free text: what reaches the
  // prompt is only ever a reading with real provenance, never a caller's
  // unvalidated claim about what the weather was.
  const weather = parseWeather(body.weatherData);

  const facts: DayFacts = {
    date: date || pack?.date || "",
    trip: trip.title,
    ...(location ? { location } : {}),
    ...(country ? { country } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(photos !== undefined ? { photos } : {}),
    ...(weatherFact ? { weather: weatherFact.text } : weather ? { weather: weatherFactLine(weather) } : {}),
  };

  const supplied = text(body.idempotency_key);
  const key = supplied === "" ? null : idempotencyKey(user, "helper.write-day", supplied);
  const fingerprint = fingerprintOf({ notes, facts, mode, toLocale, photoIds, title: text(body.title) });
  const recalled = await recall<Record<string, unknown>>(key, fingerprint);
  // A retry gets the first answer back and is not charged again. A *different*
  // call under the same key is refused rather than answered with somebody
  // else's day — `lib/idempotency.ts` explains what that cost the first time.
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  // B2591 — checked before the model call, so a refusal never pays for one:
  // an AI day is spent by the *first* draft, polish or photo description on
  // a date, and this date may already have spent it (free) or the plan may
  // have none left (refused).
  const gate = await checkAiDay(user, tripId, facts.date);
  if (!gate.ok) {
    refused(user, "draft_words", "plan_limit");
    return Response.json(gate.refusal, { status: 402 });
  }

  // `titles` (TIX-2) is its own short branch: no draft/polish prose, no
  // thread note (the same reasoning `polish` already gives — this is a
  // one-shot side-by-side preview, not a proposal the model could chain
  // into `set_day_words`). Suggested, never kept on its own say-so: each
  // title is also checked here against `titleIsGroundedInNotes`
  // (`lib/helper/polishGuard.ts`) and dropped if it fails, the prompt in
  // `TITLES_SYSTEM_PROMPT` being the first line and not the guard.
  if (mode === "titles") {
    let suggested: string[];
    try {
      suggested = await suggestTitles(notes, facts, user);
    } catch {
      refused(user, "draft_words", "model_failed");
      return Response.json({ error: "model_failed" }, { status: 502 });
    }
    await recordAiDay(user, tripId, facts.date);
    // B2684 — the same fact text `buildPrompt` actually sent, so a title
    // using the day's own place name is not refused for a word it was
    // never allowed to use in the first place.
    const factWords = [facts.location, facts.country, facts.trip].filter((v) => !!v).join(" ");
    const titles = suggested.filter((t) => titleIsGroundedInNotes(notes, t, factWords));
    const answer = { ok: true, titles, aiDay: facts.date || null, provider: HELPER_PROVIDER };
    await remember(key, fingerprint, answer);
    return Response.json(answer);
  }

  // `translate` (B2675) — the owner's own already-written title and words,
  // faithfully into one other language this journal publishes in. No
  // thread note, the same reasoning `polish`/`titles` give: a one-shot
  // side-by-side preview, not a proposal the model could chain into
  // `set_day_words`.
  if (mode === "translate") {
    let result: { title: string; content: string };
    try {
      result = await translateDay(text(body.title), notes, toLocale, user);
    } catch {
      refused(user, "draft_words", "model_failed");
      return Response.json({ error: "model_failed" }, { status: 502 });
    }
    await recordAiDay(user, tripId, facts.date);
    const answer = { ok: true, title: result.title, content: result.content, locale: toLocale, aiDay: facts.date || null, provider: HELPER_PROVIDER };
    await remember(key, fingerprint, answer);
    return Response.json(answer);
  }

  // `tags` (B2675) — up to six tags from the day's own words and, when
  // sent, its own photographs. Same no-thread-note reasoning as `titles`.
  // The model's raw suggestions are validated here (`tagsFrom`), the same
  // "grounded, then checked" split `titleIsGroundedInNotes` already uses.
  if (mode === "tags") {
    const images = await resolvePhotoImages(user, photoIds);
    let suggested: string[];
    try {
      suggested = await tagDay(notes, images, user);
    } catch {
      refused(user, "draft_words", "model_failed");
      return Response.json({ error: "model_failed" }, { status: 502 });
    }
    await recordAiDay(user, tripId, facts.date);
    const tags = tagsFrom(suggested);
    const answer = { ok: true, tags, aiDay: facts.date || null, provider: HELPER_PROVIDER };
    await remember(key, fingerprint, answer);
    return Response.json(answer);
  }

  let written;
  try {
    written = await writeDay(notes, facts, user, mode);
  } catch {
    // "A failed AI call uses no day" — nothing was recorded yet, so there is
    // nothing to give back. What a provider says when it is unhappy is not
    // something to render on somebody's phone.
    refused(user, "draft_words", "model_failed");
    return Response.json({ error: "model_failed" }, { status: 502 });
  }

  // B2190 — the guard AGENTS.md and B829 both call for: not prompt wording,
  // but a check on what actually came back. A polish that introduces a fact
  // the owner never wrote is refused and refunded exactly like a failed
  // model call, with its own code so the client can say what happened.
  //
  // 422, not 502: the model answered fine and the provider did nothing
  // wrong — this is this route rejecting the content of a successful
  // response, which is what 422 means and 502 (a bad upstream answer)
  // does not. A security review caught the mismatch (B2190's second
  // follow-up).
  if (mode === "polish") {
    const guard = checkPolishForAddedFacts(notes, written.prose);
    if (!guard.ok) {
      refused(user, "draft_words", "polish_added_facts");
      return Response.json({ error: "polish_added_facts" }, { status: 422 });
    }
    // B2630 — a word whose accents were guessed into a different word goes
    // back to exactly what was typed.
    written = { ...written, prose: keepTypedWhereAccentsGuessed(notes, written.prose) };
  }

  // Only now — the model answered, and (in polish mode) the guard accepted
  // it — is the date's AI day actually recorded.
  await recordAiDay(user, tripId, facts.date);

  /**
   * The title and the prose, and not the warnings — B945.
   *
   * `warnings` is a pressure valve pointed at the *model*: given somewhere to
   * say what it deliberately left out, leaving it out becomes an acceptable
   * answer instead of a failure, which is what stops a thin note being rounded
   * up into a paragraph. `SYSTEM_PROMPT` explains it at length.
   *
   * It was never something to hand on, and handing it on made it a claim.
   * Driven live, notes saying *"rained most of the afternoon so we ducked into
   * the maritime museum"* came back with prose containing that sentence and a
   * warning saying the weather had been *omitted from prose*. The prose was
   * right — she said it, so writing it is right — and the warning described
   * something that had not happened, to somebody who had not asked.
   *
   * Nothing renders it, so nobody saw it until a tester read the JSON. A field
   * nothing shows, saying something untrue, is worse than either showing it or
   * dropping it, and the valve only ever needed one end.
   */
  const { warnings: _valve, ...draft } = written;
  const answer = {
    ok: true,
    draft,
    aiDay: facts.date || null,
    provider: HELPER_PROVIDER,
  };
  /**
   * Not a write, and the note says so — B939.
   *
   * This route returns prose and puts nothing in the journal; keeping the
   * words is `set_day_words`, a second proposal with a second press. The old
   * client-posted note called it `written: draft_words`, which is the exact
   * class of claim this conversation is not allowed to make.
   *
   * **The words themselves ride along — B971.** A note is plain text folded
   * into the next thing the person says (`lib/helper/thread.ts`); the actual
   * title and prose are shown only in the proposal's own form fields, which
   * are rendered in the browser and never become part of the conversation.
   * Without them here, "that looks good, save it" left the model with
   * nothing to put in `set_day_words`'s `content` but its own memory of a
   * paragraph it never actually held — so it called `draft_words` again
   * instead, re-offering the same card and asking the model again. Putting
   * the drafted title and prose in the note is what makes "save it" a call
   * the model can actually make, with the words they read rather than a
   * paraphrase of them.
   */
  // `polish` never reaches the thread — it is a one-shot side-by-side
  // preview inside the wizard (`PolishText.tsx`), not a proposal the model
  // could chain into `set_day_words`, so there is nothing true to note here.
  if (mode === "draft") {
    note(
      user,
      `[drafted: words for ${tripId}/${facts.date}, kept nowhere yet — the proposal to keep them is on their screen. If they now say to keep it, call set_day_words with exactly this, verbatim: ${JSON.stringify(
        { trip: tripId, date: facts.date, title: written.title, content: written.prose },
      )}]`,
    );
  }
  await remember(key, fingerprint, answer);
  return Response.json(answer);
}
