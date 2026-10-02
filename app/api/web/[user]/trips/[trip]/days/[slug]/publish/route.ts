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
import { missingAtPublish } from "@/lib/api/v2/days";
import { readDryRun } from "@/lib/api/v2/route";
import { readDayFile, readTripFile, resolveDayStem, writeDayFile } from "@/lib/api/v2/store";
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

/**
 * Security review follow-up — nothing may go live before the whole day
 * passes. `publishBlankReasonFor` answers every `DAY_DECLINABLE_KEYS` field
 * except `visibility` (and `status`, which `missingAtPublish` never reports
 * blank in the first place), so a day's own `missingAtPublish` reduces to
 * exactly one question once this route's own auto-decline is accounted for:
 * is `visibility` among the blanks. A day this is true for will always 422
 * `incomplete_day` once `applyPublish` actually runs — checked here, before
 * the weather fill or any part's write, so that remains true with zero
 * writes rather than a half-published day found out mid-call.
 */
function blankVisibility(day: DayFile, locales: readonly string[]): boolean {
  return missingAtPublish(day, locales).some((row) => row.field === "visibility");
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

  // B2674 — every named part checked before anything is written: it has to
  // actually exist, be a draft (not already published, not some other kind
  // of refusal), and share the chosen day's own date.
  const rawPartSlugs = [...new Set(parsed.data.parts ?? [])];
  const resolvedParts: ResolvedPart[] = [];
  for (const partSlug of rawPartSlugs) {
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
    resolvedParts.push(resolved);
  }
  // Security review follow-up — deduplicated by resolved stem, after
  // resolving: `"foo"` and `"2026-10-01-foo"` can both be sent for the same
  // day, and are the same part. The main day's own stem is excluded here
  // too, however it was spelled in `parts` — it is published once, as the
  // main slug, never twice.
  const seenStems = new Set<string>([main.stem]);
  const parts: ResolvedPart[] = [];
  for (const resolved of resolvedParts) {
    if (seenStems.has(resolved.stem)) continue;
    seenStems.add(resolved.stem);
    parts.push(resolved);
  }

  const locales = getUser(user)?.locales ?? [];
  // Security review follow-up — nothing goes live before the whole day
  // passes, zero writes included: every part and the main day are checked
  // for a blank `visibility` (the one field this route never auto-declines,
  // `blankVisibility`'s own comment) before the weather fill below, which is
  // itself a write.
  for (const part of [main, ...parts]) {
    if (blankVisibility(part.day, locales)) {
      return Response.json(
        {
          error: "incomplete_day",
          message: `"${part.slug}" has not said who may see it (visibility). Nothing was published.`,
          slug: part.slug,
        },
        { status: 422 },
      );
    }
  }

  // Security review follow-up — a snapshot of each day exactly as it stood
  // before this call touched anything, taken before the weather fill below
  // (itself a write): `rollback()` restores these whole, so a declined
  // reason or a weather fill this call added disappears along with the
  // publish it was part of, rather than lingering on a draft that looks
  // like somebody answered it.
  const snapshots = new Map<string, DayFile>([main, ...parts].map((p) => [p.stem, p.day]));

  const tell = parsed.data.tell;
  const onlyContacts = tell?.groups ? await contactsInGroups(user, tell.groups) : undefined;

  /** The per-field reason table (`publishBlankReasonFor`), built fresh for
   *  each day: `weather`'s own reason depends on that day's own place. */
  const declineReasonFor = (day: DayFile) => (field: string) => publishBlankReasonFor(field, day);

  const published: string[] = [];
  /** Roll back everything this call put up — B2674's "all or nothing".
   *  Restores the whole snapshot (declines, weather fill and all), not just
   *  the `published` → `draft` status flip `applyUnpublish` alone would
   *  leave behind (security review follow-up). A restore failing here (it
   *  should not: this call itself just read and wrote these same files) is
   *  swallowed rather than compounding the original failure with a second
   *  one. */
  async function rollback(): Promise<void> {
    for (const stem of published) {
      const snapshot = snapshots.get(stem);
      if (!snapshot) continue;
      try {
        writeDayFile(user, tripId, stem, snapshot);
      } catch {
        // Best effort — see the comment above.
      }
    }
  }

  // Security review follow-up — everything from here on writes, so a throw
  // that was not already turned into a refusal response (a bug, a storage
  // hiccup) must roll back whatever this call already put up before it ever
  // reaches the caller as a bare 500 over a half-published day.
  try {
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
  } catch {
    await rollback();
    return Response.json(
      { error: "publish_failed", message: "Something went wrong while publishing. Nothing was published." },
      { status: 500 },
    );
  }
}
