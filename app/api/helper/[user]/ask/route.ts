import { isEnabled } from "@/lib/capabilities";
import { helperConsent } from "@/lib/helper/consent";
import { intentFor, slotsFor, type Say } from "@/lib/helper/intents";
import { routeAsk, UNKNOWN_INTENT } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
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

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/ask">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request);
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
    return Response.json({
      ok: true,
      intent: UNKNOWN_INTENT,
      kind: UNKNOWN_INTENT,
      slots: {},
      confidence: routed.confidence,
    });
  }

  const slots = slotsFor(intent, routed.slots);
  const common = { ok: true, intent: intent.name, slots, confidence: routed.confidence };

  if (intent.kind === "read") {
    const locale = await requestLocale();
    const say: Say = (key, vars) =>
      translateIn(locale, key as Parameters<typeof translateIn>[1], vars);
    return Response.json({ ...common, kind: "read", answer: await intent.answer(user, say) });
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
