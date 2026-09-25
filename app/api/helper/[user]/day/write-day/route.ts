import { isEnabled } from "@/lib/capabilities";
import { refund, spend } from "@/lib/credits";
import { hasHelperConsent } from "@/lib/helper/consent";
import { HELPER_PROVIDER, WRITE_DAY_CREDITS, writeDay, type DayFacts, type WriteDayMode } from "@/lib/helper/model";
import { checkPolishForAddedFacts } from "@/lib/helper/polishGuard";
import { WRITE_DAY_FACT_MAX_CHARS, WRITE_DAY_NOTES_MAX_CHARS } from "@/lib/helper/credits";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { note, refused } from "@/lib/helper/thread";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { readJsonBody } from "@/lib/api/jsonBody";

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
 * then the credit, then the model: each one is cheaper than the next, and the
 * expensive one is the only one that can fail after money has moved — which is
 * what the refund is for.
 */

/** Fifteen minutes, and comfortably more write-ups than a person on a bus
 *  makes. It is a brake on a script, not a quota; the credit is the quota. */
const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

  const notes = text(body.notes);
  if (notes === "") {
    refused(user, "draft_words", "no_notes");
    return Response.json({ error: "no_notes" }, { status: 400 });
  }
  // B2223 — a flat price over an input the operator pays for per token needs
  // a ceiling. Both modes, before consent and before the spend.
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
  // are bounded too, and also before any spend. `date` is optional (the
  // polish link sends none), but when it is sent it has to be a date.
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

  // `polish` (B2190) reworks the owner's own already-written text; anything
  // else — including no field at all, which is every existing caller,
  // WhatsApp's `draft_words` included — keeps the original `draft` behaviour.
  const mode: WriteDayMode = text(body.mode) === "polish" ? "polish" : "draft";

  // Before the first model call ever made for this journal, and before the
  // spend — a charge for a call that consent would have refused is a charge
  // for nothing. Not recorded as a press refusal: consent, like the
  // capability switch above, is a gate on whether the wizard may speak to a
  // model at all, not a press failing on what it asked for.
  if (!hasHelperConsent(user, "words")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const facts: DayFacts = {
    date,
    trip: trip.title,
    ...(text(body.location) ? { location: text(body.location) } : {}),
    ...(text(body.country) ? { country: text(body.country) } : {}),
    ...(text(body.from) ? { from: text(body.from) } : {}),
    ...(text(body.to) ? { to: text(body.to) } : {}),
    ...(typeof body.photos === "number" ? { photos: body.photos } : {}),
  };

  const supplied = text(body.idempotency_key);
  const key = supplied === "" ? null : idempotencyKey(user, "helper.write-day", supplied);
  const fingerprint = fingerprintOf({ notes, facts, mode });
  const recalled = await recall<Record<string, unknown>>(key, fingerprint);
  // A retry gets the first answer back and is not charged again. A *different*
  // call under the same key is refused rather than answered with somebody
  // else's day — `lib/idempotency.ts` explains what that cost the first time.
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  const ledgerRef = `${user}/${tripId}/${facts.date}`;
  if (!(await spend(user, WRITE_DAY_CREDITS, "helper", ledgerRef))) {
    refused(user, "draft_words", "no_credits");
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  let written;
  try {
    written = await writeDay(notes, facts, user, mode);
  } catch {
    // The credit bought nothing, so it is given back. Nothing about the
    // failure is passed on: what a provider says when it is unhappy is not
    // something to render on somebody's phone.
    await refund(user, WRITE_DAY_CREDITS, ledgerRef);
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
      await refund(user, WRITE_DAY_CREDITS, ledgerRef);
      refused(user, "draft_words", "polish_added_facts");
      return Response.json({ error: "polish_added_facts" }, { status: 422 });
    }
  }

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
    spent: WRITE_DAY_CREDITS,
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
   * instead, re-offering the same card and spending a second credit. Putting
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
