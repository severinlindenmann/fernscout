import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent, helperConsent } from "@/lib/helper/consent";
import { intentFor, refusalFor, slotsFor, type Say } from "@/lib/helper/intents";
import { answerInThread, routeAsk, UNKNOWN_INTENT } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { history, remember } from "@/lib/helper/thread";
import { speechProvider } from "@/lib/helper/transcribe";
import { requestLocale, translateIn } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * A sentence in, a row name out — B685, §3 of
 * `docs/plans/2026-09-07-web-helper-agent.md`.
 *
 * **Free.** Nothing here touches the ledger, and that is a decision rather
 * than an oversight: at roughly a third of a rappen a turn, metering the front
 * door would cost more in people not daring to knock than it could ever
 * recover. What it lands on may cost something, and that button says so.
 * `lib/rateLimit.ts` is the brake instead.
 *
 * **The model routes; it never executes.** It is given no client and no tools
 * (`routeAsk` in `lib/helper/model.ts`), and what it returns is a row name
 * this route looks up in the registry. A read-only row is answered here and
 * now — those are GETs a person could make from their own page and there is
 * nothing to confirm about being told a number. A row that writes comes back
 * as fields to confirm, however confident the router was; the confirming is
 * the browser's job and the writing is a second call.
 *
 * **And a sentence no row fits goes to the thread** — B889, round 1 of
 * `docs/plans/2026-09-07-helper-as-an-agent.md`. `answerInThread` is given the
 * conversation so far and a list of **read** tools; it answers in prose in the
 * person's own language and can change nothing, because there is no write tool
 * to give it. `unknown` stays underneath, as the answer when the model fails.
 * The refusal table above still runs first and still never depends on any
 * model's judgement — and a refused sentence is not remembered either, so it
 * cannot reach a model on the following turn instead.
 *
 * Cookie only, owner only, bearer refused by construction — `isHelperOwner`.
 */

/** Fifteen minutes. Well above a person thinking out loud, well below a
 *  script working through a phrasebook. */
const LIMIT = { max: 40, windowMs: 15 * 60 * 1000 };

/**
 * Below this, the router's own answer is treated as `unknown`.
 *
 * A model that says it is half sure is a model guessing, and a guess that
 * opens the wrong screen is worse than the menu the person already had —
 * which is exactly what `unknown` lands on.
 */
const SURE_ENOUGH = 0.5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether this box belongs on the page asking, and what it needs to draw
 * itself — B844.
 *
 * `/agent` reads all five of these on the server and hands them to
 * `HelperAsk` as props. A journal page cannot: the day card and the trip
 * overview are client components several levels below a page that knows
 * nothing about the helper, and threading five props through `TripStory` and
 * `StoryPager` to reach them would put the capability into the props of every
 * page that renders a day.
 *
 * So the component asks, the same shape `InviteToRead` already has beside it:
 * a 404 means "not yours, or switched off here", and the answer to a 404 is
 * to draw nothing at all rather than a box that explains itself after being
 * pressed. Owner only, so this reveals nothing about somebody else's journal
 * — `notYourJournal` gives the same answer for a journal that is not yours as
 * for one that does not exist.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/ask">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  return Response.json({
    ok: true,
    consented: Boolean(helperConsent(user)),
    speech: isEnabled("transcription", user),
    consentedSpeech: hasHelperConsent(user, "speech"),
    speechProvider: speechProvider(),
  });
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/ask">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-ask", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const said = typeof body.said === "string" ? body.said.trim().slice(0, 500) : "";
  if (said === "") return Response.json({ error: "no_question" }, { status: 400 });

  const locale = await requestLocale();
  const say: Say = (key, vars) =>
    translateIn(locale, key as Parameters<typeof translateIn>[1], vars);

  /**
   * B817 — before the model, and before their words leave the machine.
   *
   * A sentence about taking something down is answered here, deterministically,
   * and never reaches the router. That ordering is the whole fix: a refusal
   * decided *after* routing is a refusal that can be argued with by a confident
   * guess, and the guess this replaces opened the screen that creates a day.
   * Nothing is written, nothing is opened, and no confidence can reach past it.
   */
  const refused = refusalFor(said);
  if (refused) {
    return Response.json({
      ok: true,
      intent: `refuse_${refused.name}`,
      // A sentence shown in the answer box, which is what `read` already is.
      kind: "read",
      refused: refused.name,
      slots: {},
      confidence: 1,
      answer: say(refused.key),
    });
  }

  // Their words go to a provider, so the same panel guards this as guards a
  // write-up. Free or not, it is the sentence that leaves the machine.
  if (!helperConsent(user)) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  // The person's own today, because "in March" is answered from where they
  // are standing. Anything that is not a date falls back to the server's.
  const today =
    typeof body.today === "string" && DATE_RE.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);

  let routed;
  try {
    routed = await routeAsk(said, today, user);
  } catch {
    return Response.json({ error: "model_failed" }, { status: 502 });
  }

  const intent = routed.confidence >= SURE_ENOUGH ? intentFor(routed.intent) : null;
  if (!intent) {
    /**
     * B889 — where `unknown` used to be the end of it.
     *
     * A registry answers what somebody wrote a row for, and four of the
     * owner's seven ordinary sentences had no row. So a sentence no row fits
     * goes to the thread instead: the conversation so far, the read tools,
     * and prose back. It still writes nothing — there is no write tool — and
     * `unknown` survives underneath as the answer when the model itself
     * fails, which is the screen that always works.
     */
    let thread;
    try {
      thread = await answerInThread(user, said, history(user), today);
    } catch {
      thread = null;
    }
    if (!thread || thread.answer === "") {
      return Response.json({
        ok: true,
        intent: UNKNOWN_INTENT,
        kind: UNKNOWN_INTENT,
        slots: {},
        confidence: routed.confidence,
      });
    }
    remember(user, said, thread.answer);
    return Response.json({
      ok: true,
      intent: "thread",
      kind: "read",
      slots: {},
      confidence: routed.confidence,
      answer: thread.answer,
      // What it actually ran, in order — so the claim its answer makes about
      // what it looked at is checkable from outside.
      looked: thread.looked,
    });
  }

  const slots = slotsFor(intent, routed.slots);
  const common = { ok: true, intent: intent.name, slots, confidence: routed.confidence };

  if (intent.kind === "read") {
    const answer = await intent.answer(user, say);
    // A row's answer is prose too, so it belongs in the conversation: asking
    // "how many credits" and then "and how long will that last" must not
    // start from nothing.
    remember(user, said, answer);
    return Response.json({ ...common, kind: "read", answer });
  }

  if (intent.kind === "open") {
    return Response.json({ ...common, kind: "open", href: intent.href(user, slots) });
  }

  // Nothing is written here. The fields go back to be looked at, and the
  // endpoint is called only if somebody presses.
  return Response.json({
    ...common,
    kind: "write",
    endpoint: intent.endpoint(user),
    fields: intent.slots.map((slot) => ({
      name: slot.name,
      value: slots[slot.name] ?? "",
      date: Boolean(slot.date),
    })),
  });
}
