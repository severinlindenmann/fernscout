import { refused, wrote } from "@/lib/helper/thread";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { patchTripDetails } from "@/lib/api/tripDetails";
import { getTrip, isPersonEmail, tripRef } from "@/lib/trips";
import { createTrip, DATE_RE, HELPER_TRIP_DECLINE_REASONS, VISIBILITIES } from "@/lib/tripWrite";
import { tripIdBase } from "@/lib/tripId";
import { getUser } from "@/lib/users";
import type { UserConfig } from "@/lib/config";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * The trip the person confirmed — B685.
 *
 * The router can propose a trip; only this can make one, and it is reached
 * either by somebody pressing a button with the title and the two dates the
 * model routed in front of them, or — since B754 — by the wizard's own "new
 * trip" form, which never spoke to a model at all. **No model is spoken to
 * here either way**: the fields arrive from a form, which is the whole
 * discipline — `createTrip` is the same function `POST /api/v1/<user>/trips`
 * calls, so a trip made this way is a trip made any other way.
 *
 * That is also why this carries no `isEnabled("helper", …)` gate the way the
 * rest of `app/api/helper/` does — B754. Every sibling route here either asks
 * a model or exists only to serve one that is running; this one does neither,
 * so gating it on the capability made the wizard's plain trip picker a
 * dead end on an instance running with no model at all, which is the default.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, for the reason `app/api/helper/[user]/day/route.ts` sets out at
 * length: the browser has a cookie and the contract's routes take a bearer
 * token, and putting a seven-day write token into a page is the thing B283
 * exists to avoid.
 *
 * The id is derived rather than asked for. It becomes part of a URL and a
 * folder name, and it is the one field of the four that somebody filling in a
 * box on a phone has no way to have an opinion about.
 */

const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A title and a year into something that ages well as a URL. */
function idFrom(username: string, title: string, start: string): string {
  const base = tripIdBase(title, start);
  let id = base;
  for (let n = 2; getTrip(tripRef(username, id)); n += 1) id = `${base}-${n}`;
  return id;
}

/**
 * A trip's own title and dates, read back — B1803 Task 3.7.
 *
 * The Preview screen (`PreviewScreen.tsx`) has to name the real trip a run
 * just committed into: `assemble-day` (via `lib/extract/commit.ts`) makes
 * up the title itself when a run starts a brand-new trip
 * (`titleFromSpan`), so nothing on the client already knows it. This is the
 * one honest way to get it back — the same `getTrip` read every other page
 * on the site uses, not a second copy of the title kept anywhere else.
 *
 * Owner only, no `isEnabled` gate — the same stance `POST` above takes and
 * for the same reason: reading a trip the owner already has costs nothing
 * and asks no model.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/trip">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const trip = id ? getTrip(tripRef(user, id)) : null;
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });
  return Response.json({ title: trip.title, start: trip.start, end: trip.end });
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/trip">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const limited = rateLimitFor("helper-trip", clientIp(request), LIMIT);
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

  const title = text(body.title);
  const start = text(body.start);
  const end = text(body.end);
  if (!title || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    refused(user, "create_trip", "invalid_trip");
    return Response.json({ error: "invalid_trip" }, { status: 400 });
  }

  /**
   * Who may read it, asked rather than defaulted — B900.
   *
   * The conversation puts the three in front of somebody as sentences, because
   * the mistake people make at exactly this moment is answering "who can see
   * it" with the wrong one of *guest* and *private*. An unrecognised word is
   * dropped rather than guessed at: `createTrip` then falls back to the
   * journal's own default, which is what a trip made without this field has
   * always got.
   */
  const said = text(body.visibility);
  const visibility = (VISIBILITIES as readonly string[]).includes(said)
    ? (said as (typeof VISIBILITIES)[number])
    : undefined;

  /**
   * B1660 — the trip-side mirror of B1650's day gate. `HELPER_TRIP_DECLINE_
   * REASONS` names the `TRIP_DECLINABLES` rows this door can actually ask
   * about today (`lib/tripWrite.ts`'s own doc comment says which of the nine
   * are missing and why); a create silent on any of them is refused here,
   * before `createTrip` ever runs, the same shape `POST .../day` already uses.
   * `"none"` is the wire sentinel for an actual decline — never invented by
   * this route, only ever sent because the model was told the person had
   * been asked and said no.
   *
   * **Gated on `isEnabled("helper", user)`, deliberately** — the one
   * difference from `POST .../day`, which carries no such gate either but has
   * never needed one because every trip it writes into already tracks
   * `costs`/`coordinates` by default. This route is reached two ways: a
   * model's `create_trip` proposal, which can always supply a value or
   * `"none"`, and a plain form with nobody to ask through at all (B754 — "the
   * wizard's own 'new trip' form", and every self-hoster's default has no
   * model configured). Refusing the second caller for silence on a question
   * nothing could ever have put in front of anybody would not be catching an
   * omission — it would make trip creation impossible on the instance's own
   * default configuration, which is the thing this route exists to keep
   * working (test/helper-day-flow.test.ts: "the trip route needs no helper
   * capability, only the cookie"). So the gate only runs where a model is
   * actually configured to do the asking.
   */
  const answered: Record<string, string> = {};
  const declined: Record<string, string> = {};
  if (isEnabled("helper", user)) {
    for (const field of Object.keys(HELPER_TRIP_DECLINE_REASONS)) {
      const raw = (body as Record<string, unknown>)[field];
      const given = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
      if (given === undefined) continue;
      if (given.toLowerCase() === "none") {
        declined[field] = HELPER_TRIP_DECLINE_REASONS[field];
      } else {
        answered[field] = given;
      }
    }
  }

  /**
   * "The rest" — B2021. The five questions the contract still had open at
   * create: a budget, this journal's other languages, how the party is
   * drawn, who is coming, and (on a closed trip) the locked card. The
   * studio's own step always sends every one of these — its primary stays
   * disabled until they are (`NewTripFlow.tsx`) — so this reads them when
   * given and otherwise defaults exactly the way the step's own defaults do,
   * silently, the same way an *omitted* `accent`/`tagline`/`intro`/`rates`
   * above is read as "none" rather than refused: a caller with no way to ask
   * these questions at all (today, the model's own `create_trip` proposal)
   * must still be able to make a trip, same reasoning `POST` above's own
   * doc comment gives for never hard-gating this route on `isEnabled
   * ("helper", …)`. `plan` needs no row here at all: `createTrip` itself
   * always declines it, since nothing this door takes could ever state one.
   */
  const NEUTRAL_DEFERRAL = "not entered during setup";
  const journal: UserConfig | null = getUser(user);

  let costsBudget: { total: number; currency?: string } | undefined;
  const costsBudgetRaw = (body as Record<string, unknown>).costsBudget;
  if (costsBudgetRaw === "none" || costsBudgetRaw === undefined) {
    declined.costs = NEUTRAL_DEFERRAL;
  } else {
    if (typeof costsBudgetRaw !== "object" || costsBudgetRaw === null || Array.isArray(costsBudgetRaw)) {
      refused(user, "create_trip", "invalid_costs_budget");
      return Response.json({ error: "invalid_costs_budget" }, { status: 400 });
    }
    costsBudget = costsBudgetRaw as { total: number; currency?: string };
  }

  let translationsInput: Record<string, { title?: string }> | undefined;
  const translationsRaw = (body as Record<string, unknown>).translations;
  if (translationsRaw === "none" || translationsRaw === undefined) {
    // Only a real question on a multi-locale journal (spec) — declining it
    // on a journal with one language would be answering a question that was
    // never asked.
    if ((journal?.locales.length ?? 0) > 1) declined.translations = NEUTRAL_DEFERRAL;
  } else {
    if (typeof translationsRaw !== "object" || translationsRaw === null || Array.isArray(translationsRaw)) {
      refused(user, "create_trip", "invalid_translations_answer");
      return Response.json({ error: "invalid_translations_answer" }, { status: 400 });
    }
    // A language left empty is deferred, not refused (spec) — only the
    // languages that actually got a title are written; if none did, this
    // answer is the same as "none".
    const nonEmpty: Record<string, { title?: string }> = {};
    for (const [locale, entry] of Object.entries(translationsRaw as Record<string, unknown>)) {
      const title =
        entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).title === "string"
          ? ((entry as Record<string, unknown>).title as string).trim()
          : "";
      if (title) nonEmpty[locale] = { title };
    }
    if (Object.keys(nonEmpty).length === 0) {
      declined.translations = NEUTRAL_DEFERRAL;
    } else {
      translationsInput = nonEmpty;
    }
  }

  // `figuresMode` is never declined — it always has a real default (the
  // journal's own set) — so an absent answer reads as that default, and
  // anything given is forwarded as-is; `createTrip`'s own `figuresModeBlock`
  // validates its shape.
  const figuresMode = (body as Record<string, unknown>).figuresMode ?? { mode: "journal" };

  // `company` only ever builds the byline now (B2297: `people:` grants
  // nothing and mails nobody) — "solo" and "later" both mean nothing beyond
  // the owner to name yet, so neither needs a decline of its own any more.
  let namedPeople: { name: string; email: string }[] | undefined;
  const company = (body as Record<string, unknown>).company;
  if (company === "named") {
    const raw = (body as Record<string, unknown>).namedPeople;
    if (!Array.isArray(raw) || raw.length === 0) {
      refused(user, "create_trip", "invalid_named_people");
      return Response.json({ error: "invalid_named_people" }, { status: 400 });
    }
    const cleaned: { name: string; email: string }[] = [];
    for (const item of raw) {
      const name = text((item as Record<string, unknown> | null)?.name);
      const email = text((item as Record<string, unknown> | null)?.email).toLowerCase();
      if (!name || !isPersonEmail(email)) {
        refused(user, "create_trip", "invalid_named_people");
        return Response.json({ error: "invalid_named_people" }, { status: 400 });
      }
      cleaned.push({ name, email });
    }
    namedPeople = cleaned;
  }

  // Absent means no card (B2185, owner decision D2) — a closed trip a
  // caller never asked about simply stays without one, exactly as every
  // trip this route made before B2021 did. The studio step's own default
  // is "show nothing", so it only ever sends `teaser` when the owner picked
  // "Show a locked card".
  let teaserAnswer: boolean | undefined;
  const teaserRaw = (body as Record<string, unknown>).teaser;
  if (typeof teaserRaw === "boolean") teaserAnswer = teaserRaw;

  if (isEnabled("helper", user)) {
    const missing = Object.keys(HELPER_TRIP_DECLINE_REASONS).filter(
      (field) => answered[field] === undefined && declined[field] === undefined,
    );
    if (missing.length > 0) {
      refused(user, "create_trip", "incomplete_trip");
      return Response.json({ error: "incomplete_trip", missing }, { status: 422 });
    }
  }

  // The owner is always on their own trip — `peopleBlock` writes exactly
  // what it is given with nothing added, so naming anyone else here means
  // building the whole byline rather than trusting `createTrip`'s own
  // owner-fallback (which only fires when the list is empty).
  const people =
    namedPeople && journal?.owner.email
      ? [
          {
            name: journal.owner.name,
            email: journal.owner.email,
            ...(journal.owner.nickname ? { nickname: journal.owner.nickname } : {}),
          },
          ...namedPeople.filter((p) => p.email !== journal.owner.email!.toLowerCase()),
        ]
      : undefined;

  const created = createTrip(user, {
    id: idFrom(user, title, start),
    title,
    start,
    end,
    ...(visibility ? { visibility } : {}),
    ...(answered.accent ? { accent: answered.accent as never } : {}),
    ...(answered.tagline ? { tagline: answered.tagline } : {}),
    ...(answered.intro ? { intro: answered.intro } : {}),
    ...(answered.rates
      ? {
          rates: {
            currencies: answered.rates
              .split(",")
              .map((c) => c.trim().toUpperCase())
              .filter((c) => c.length === 3),
          },
        }
      : {}),
    ...(costsBudget ? { costsBudget } : {}),
    ...(translationsInput ? { translations: translationsInput } : {}),
    figuresMode,
    ...(people ? { people } : {}),
    ...(teaserAnswer !== undefined ? { teaser: teaserAnswer } : {}),
    ...(Object.keys(declined).length ? { declined } : {}),
  });
  if (!created.ok) {
    refused(user, "create_trip", created.error);
    return Response.json({ error: created.error, message: created.message }, { status: 400 });
  }
  // The id the *server* derived, not the title the model sent — B939. This is
  // the one fact about a new trip nobody in the conversation could otherwise
  // know.
  wrote(user, "create_trip", { id: created.id, title, start, end });
  return Response.json(
    { ok: true, id: created.id, href: `/${encodeURIComponent(user)}/trips/${created.id}` },
    { status: 201 },
  );
}

const PATCH_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

/**
 * The correction — `edit_trip`, once the trip already exists.
 *
 * Unlike the POST above, this **does** carry `isEnabled("helper", …)`: there
 * is no plain-form fallback for editing a trip the way there is for making
 * one, so a hosted instance with the model switched off has no other door
 * that reaches this and no reason to leave one open.
 *
 * `patchTripDetails` is the same function `PATCH /api/v1/<user>/trips/<trip>`
 * calls, so a trip edited from the conversation is a trip edited any other
 * way. Only `title`, `start` and `end` are offered here — `cover`, `accent`,
 * `intro` and `costsVisibility` are real fields on that route but nobody has
 * ever asked this conversation to change one, and a field on the card that is
 * never the answer is a field somebody reads past every time.
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/helper/[user]/trip">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-trip-edit", clientIp(request), PATCH_LIMIT);
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

  const ref = tripRef(user, text(body.trip));
  if (!getTrip(ref)) {
    refused(user, "edit_trip", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const result = patchTripDetails(ref, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.start !== undefined ? { start: body.start } : {}),
    ...(body.end !== undefined ? { end: body.end } : {}),
  });
  if (!result.ok) {
    refused(user, "edit_trip", result.error);
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  wrote(user, "edit_trip", { trip: ref, title: result.title, start: result.start, end: result.end });
  return Response.json({ ok: true, trip: ref, title: result.title, start: result.start, end: result.end });
}
