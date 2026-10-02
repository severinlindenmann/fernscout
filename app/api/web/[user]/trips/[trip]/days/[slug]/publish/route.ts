// POST /api/web/{user}/trips/{trip}/days/{slug}/publish — putting a draft on
// the site, from a cookie — B2140, the studio's "Publish a day".
//
// The twin of `../unpublish/route.ts` beside it, and the same shape for the
// same reason: `POST /api/v2/.../publish` takes a bearer token and a browser
// must never hold one (decision 24). `isOwner` on the cookie only — any
// `Authorization` header is refused outright — and then `applyPublish`, the
// exact function the v2 route calls after its own owner-only gate.
//
// **This door sends, since TIX-6.** `tell` names who hears about it (reader
// groups, and whether to mail them); push always goes to that same audience
// when the push capability is on. Of the body the browser posted, `tell`
// and `parts` are the only fields read — `sendMail`/`sendWhatsapp` are never
// accepted from here, so a browser can never ask for a WhatsApp send.
//
// **B2674 — a whole day, one call.** `parts` names the other draft slugs of
// the same trip and the same date (TIX-2's "day in parts"). Every part is
// checked — it exists, it is a draft, it is on the chosen day's own date —
// before anything is written; publishing itself is then all or nothing: if
// a later part fails after an earlier one already went up, the ones that
// went up come back down and the failure is returned as if nothing had
// happened. Notifications go out exactly once, for the day, from the main
// slug (`applyPublish`'s `quiet` option keeps every other part silent — no
// mail, no WhatsApp, no push, no claim burned for any of them). The
// response, consumed by the studio's own Preview page:
//
//   { ok: true, published: string[], told: { app: number, mail: number } }
//
// `published` is every slug now live, main slug first. `told` counts
// readers only — the owner's own devices still receive the push (unchanged
// behaviour) but are never counted, per B2674 decision D10.
//
// **The studio answers its own blanks, honestly, per field — B2674.** The
// client no longer sends `declineOpen`: nothing else in the tree ever did
// (grepped), so it is removed outright rather than kept as a no-op. Every
// field still blank at publish, except `visibility`, is declined
// automatically with its own reason from `publishBlankReasonFor`
// (`lib/studio/publishBlankReasons.ts`) — never the old one-size-fits-all
// "left blank when the owner shared this day from the studio" line, which
// read as if the owner had been asked field by field and chosen silence.
// `visibility` stays a hard 422 (`incomplete_day`): the new Preview page
// (B2677) sets it inline before publishing, so publish never has to guess it.
import { z } from "zod";
import { applyPublish } from "@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route";
import { applyUnpublish } from "@/app/api/v2/[user]/trips/[trip]/days/[slug]/unpublish/route";
import { missingAtPublish } from "@/lib/api/v2/days";
import { readDryRun } from "@/lib/api/v2/route";
import { readDayFile, readTripFile, resolveDayStem } from "@/lib/api/v2/store";
import type { DayFile } from "@/lib/api/v2/documents";
import { fillDayWeatherQuietly } from "@/lib/api/weather";
import { publishBlankReasonFor } from "@/lib/studio/publishBlankReasons";
import { tripRef } from "@/lib/trips";
import { isOwner } from "@/lib/contacts/session";
import { contactsInGroups, saveTellChoice } from "@/lib/digest/tellChoice";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** More than one journal could ever realistically add to one date. */
const MAX_PARTS = 20;

const shareBody = z.object({
  /** B2674 — the other draft slugs of this same trip and this same date,
   *  going up alongside the chosen one in the same all-or-nothing call. */
  parts: z.array(z.string().min(1)).max(MAX_PARTS).optional(),
  /**
   * TIX-6 — who is told. `groups`: reader-group ids and `"none"`, or null for
   * everyone; `mail`: email them as well as the app notification. Absent =
   * the old behaviour (app notification to everyone, no mail). Group ids are
   * resolved to people here, on the server, against this owner's own groups.
   */
  tell: z
    .object({ groups: z.array(z.string().min(1).max(64)).max(25).nullable(), mail: z.boolean() })
    .optional(),
});

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent publishes a day with " +
    "POST /api/v2/{user}/trips/{trip}/days/{slug}/publish, once the owner has said so.",
};

/** One resolved, still-draft day, ready to check or to publish. */
type ResolvedPart = { slug: string; stem: string; day: DayFile };

function resolve(user: string, tripId: string, slug: string): ResolvedPart | null {
  const stem = resolveDayStem(user, tripId, slug);
  const day = stem ? readDayFile(user, tripId, stem) : null;
  return stem && day ? { slug, stem, day } : null;
}

/** Every field this day has neither filled in nor answered, except
 *  `visibility` — the one blank the studio never answers on the owner's
 *  behalf (B2674). */
function ownBlanks(day: DayFile, locales: readonly string[]): string[] {
  return missingAtPublish(day, locales)
    .map((row) => row.field)
    .filter((field) => field !== "visibility");
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]/publish">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip: tripId, slug } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (!readTripFile(user, tripId)) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  const main = resolve(user, tripId, slug);
  if (!main) {
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }

  const parsed = shareBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", message: "parts must be a list of day slugs; tell, if present, an object." },
      { status: 400 },
    );
  }

  // B2674 — every part checked before anything is written: it has to
  // actually exist, be a draft (not already published, not some other kind
  // of refusal), and share the chosen day's own date. A part named twice,
  // or named as the main slug itself, collapses to one.
  const partSlugs = [...new Set(parsed.data.parts ?? [])].filter((s) => s !== slug);
  const parts: ResolvedPart[] = [];
  for (const partSlug of partSlugs) {
    const resolved = resolve(user, tripId, partSlug);
    if (!resolved) {
      return Response.json(
        { error: "invalid_request", message: `"${partSlug}" is not a day of this trip. Nothing was published.` },
        { status: 400 },
      );
    }
    if (resolved.day.status === "published") {
      return Response.json(
        { error: "invalid_request", message: `"${partSlug}" is already on the site. Nothing was published.` },
        { status: 400 },
      );
    }
    if (resolved.day.date !== main.day.date) {
      return Response.json(
        {
          error: "invalid_request",
          message: `"${partSlug}" is not on ${main.day.date}, the day being published. Nothing was published.`,
        },
        { status: 400 },
      );
    }
    parts.push(resolved);
  }

  const locales = getUser(user)?.locales ?? [];
  // A day saved too recently for the archive still carries `weather: true`
  // (asked, unanswered). Asked again now, for every part going up — the
  // same quiet best-effort fill the single-day door already did, capability-
  // gated inside and every failure swallowed, so it never stands between
  // the owner and the share.
  if (readDryRun(request) === false) {
    for (const part of [main, ...parts]) {
      if (part.day.weather === true) await fillDayWeatherQuietly(tripRef(user, tripId), part.stem);
    }
  }

  const tell = parsed.data.tell;
  const onlyContacts = tell?.groups ? await contactsInGroups(user, tell.groups) : undefined;

  /** The per-field reason table (`publishBlankReasonFor`), built fresh for
   *  each day: `weather`'s own reason depends on that day's own place. */
  const declineReasonFor = (day: DayFile) => (field: string) => publishBlankReasonFor(field, day);

  const published: string[] = [];
  /** Roll back everything this call put up — B2674's "all or nothing". An
   *  unpublish failing here (it should not: these slugs were drafts a
   *  moment ago and this call just published them) is swallowed rather than
   *  compounding the original failure with a second one. */
  async function rollback(): Promise<void> {
    for (const part of published) {
      await applyUnpublish(user, tripId, part).catch(() => undefined);
    }
  }

  // The other parts go up first, quietly (no mail, no WhatsApp, no push —
  // `applyPublish`'s `quiet` option) — the chosen one goes last and is the
  // only one that tells anybody, once.
  for (const part of parts) {
    const body = JSON.stringify({ declineTracked: ownBlanks(part.day, locales) });
    const response = await applyPublish(
      new Request(request.url, { method: "POST", body }),
      user,
      tripId,
      part.stem,
      declineReasonFor(part.day),
      onlyContacts,
      /* quiet */ true,
    );
    if (!response.ok) {
      await rollback();
      return response;
    }
    published.push(part.stem);
  }

  const mainBody = JSON.stringify({
    declineTracked: ownBlanks(main.day, locales),
    ...(tell?.mail ? { sendMail: true } : {}),
  });
  const mainResponse = await applyPublish(
    new Request(request.url, { method: "POST", body: mainBody }),
    user,
    tripId,
    main.stem,
    declineReasonFor(main.day),
    onlyContacts,
    /* quiet */ false,
  );
  if (!mainResponse.ok) {
    await rollback();
    return mainResponse;
  }
  published.push(main.stem);

  const mainResult = (await mainResponse.json()) as {
    mail?: { sent?: number };
    push?: { told?: number };
  };
  // Remembered only once it actually went up — the next day of this trip
  // offers the same people again.
  if (tell) await saveTellChoice(user, tripId, { groups: tell.groups, mail: tell.mail });

  return Response.json({
    ok: true,
    published,
    told: { app: mainResult.push?.told ?? 0, mail: mainResult.mail?.sent ?? 0 },
  });
}
