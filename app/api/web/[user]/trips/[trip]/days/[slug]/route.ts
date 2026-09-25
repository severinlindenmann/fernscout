// PATCH /api/web/{user}/trips/{trip}/days/{slug} — the owner correcting
// their own day, from a cookie — B1595 (v2 migration, phase 2 step 5), and
// the door B980 built for exactly this.
//
// `PATCH /api/v2/{user}/trips/{trip}/days/{slug}` takes a bearer token, and a
// browser must never hold one (decision 24). This is the cookie-side door:
// `isOwner` on the cookie only — any `Authorization` header is refused
// outright — and then `applyDayPatch`, the exact function the v2 route calls
// after its own trip-write gate, in process. No bearer token is minted,
// held, or sent anywhere for this call.
//
// Replaces `app/[user]/trips/[trip]/day/[slug]/edit/route.ts`, which wrote
// through v1's `editEntry` against the pre-B1598 file shape and a flat
// `captions`/`photoVisibility` vocabulary v2 retired in favour of `media`
// array items each carrying their own `caption`/`visibility` (owner review,
// 2026-09-12) — `components/EditDay.tsx` builds that array now.
import { applyDayPatch } from "@/app/api/v2/[user]/trips/[trip]/days/[slug]/route";
import { etagFor, readJson } from "@/lib/api/v2/route";
import { readDayFile, readTripFile, resolveDayStem } from "@/lib/api/v2/store";
import { dayDoc } from "@/lib/api/v2/schemas";
import { tripRef } from "@/lib/trips";
import { dayEchoInput, withResolvedTest } from "@/lib/api/v2/days";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { TRASH_DAYS, trashDay } from "@/lib/dayTrash";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { listDrafts } from "@paid/photobook/lib/photobook/drafts";
import { listPhotobookOrders } from "@paid/photobook/lib/photobook/orders";
import { photobookPhotoRefs } from "@/lib/studio/reshapeDay";
import { isExpired, isPending, listOrders as listPostcardOrders } from "@paid/postcard/lib/postcard/orders";

export const dynamic = "force-dynamic";

/**
 * What the panel can actually draw — and the route accepts nothing else.
 *
 * Carried over from the v1 route this replaces, because the reason was never
 * about v1: **a field nobody can type is a field this route has no business
 * accepting.** There is no CMS here (decision 24), and `EditDay` is a
 * correction to a day somebody already has rather than a form that composes
 * one. The allowlist is what keeps that architectural, instead of a promise
 * the next page to grow an input can quietly break.
 *
 * It cannot publish or unpublish either, and that needs no entry here:
 * `status` is server-owned and absent from `dayPatch` altogether, so a day
 * moves on and off the site only through its own door (B28, B266).
 *
 * B1586 is why this list is checked against the panel rather than trusted:
 * it stopped following `EditDay` when the panel grew a caption box, and the
 * two missing fields were refused for four days while the panel offered them.
 * If you add an input, add it here in the same change.
 */
const EDITABLE = [
  "title",
  "time",
  "content",
  "location",
  "date",
  "visibility",
  "translations",
  "media",
  "declined",
  // B2233 — "Change a day" draws costs, how you travelled and tags.
  "costs",
  "transportMode",
  "tags",
] as const;

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent corrects a day with " +
    "PATCH /api/v2/{user}/trips/{trip}/days/{slug}.",
};

/**
 * GET the day's current `ETag` — nothing else. D12 (spec §6): "Change a day"
 * holds the version it read and refuses a save built on a stale one, the
 * same `If-Match`/`stale_document` mechanism `applyDayPatch` already
 * enforces for an agent's own bearer-authenticated PATCH. `EditDay.tsx`
 * fetches this once per update when the panel opens and sends it back as
 * `If-Match` on save — the full document is not needed for that, so this
 * answers with only the tag rather than a second read-back door.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip: tripId, slug } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const trip = readTripFile(user, tripId);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });
  // `slug` here is `Entry.slug` — bare, the app-facing form every owner
  // page actually holds — and this store addresses a day by its full,
  // date-prefixed filename stem. Resolved once, here, rather than every
  // caller of this route having to know the difference (`resolveDayStem`'s
  // own doc comment has the story of the bug this closes).
  const stem = resolveDayStem(user, tripId, slug);
  const day = stem ? readDayFile(user, tripId, stem) : null;
  if (!day) return Response.json({ error: "unknown_day" }, { status: 404 });

  const doc = dayDoc.parse(withResolvedTest(dayEchoInput(day, tripRef(user, tripId)), trip, day));
  return Response.json({ etag: etagFor(doc) });
}

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip: tripId, slug } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const trip = readTripFile(user, tripId);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });
  // See the GET handler's own comment on `resolveDayStem` just above.
  const stem = resolveDayStem(user, tripId, slug);
  if (!stem) return Response.json({ error: "unknown_day" }, { status: 404 });

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const offered = Object.keys(body.value as Record<string, unknown>);
  const unknown = offered.filter((key) => !(EDITABLE as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return Response.json(
      {
        error: "not_editable_here",
        message:
          `This door writes only what the edit panel draws: ${EDITABLE.join(", ")}. ` +
          `It was sent ${unknown.join(", ")}. An agent changes the rest with ` +
          `PATCH /api/v2/{user}/trips/{trip}/days/{slug}.`,
      },
      { status: 400 },
    );
  }

  // D12 (spec §6) — `If-Match`, forwarded rather than dropped, is what turns
  // `applyDayPatch`'s existing `stale_document` refusal on for this door
  // too. No header at all keeps the old last-write-wins default: a caller
  // that never read this route's own `GET` (or an older client of it) is
  // unaffected, exactly as `ifMatchStale` already documents for the v2 side.
  const ifMatch = request.headers.get("if-match");
  return applyDayPatch(user, tripId, stem, trip, new Request(request.url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(ifMatch ? { "if-match": ifMatch } : {}),
    },
    body: JSON.stringify(body.value),
  }));
}

/**
 * DELETE — the owner deleting a day from the studio — B2259.
 *
 * Not the v2 `DELETE` (drafts only, photographs kept, nothing to undo): this
 * door moves the day, its photographs, their originals and sidecars into the
 * journal's trash (`lib/dayTrash.ts`), where "Recently deleted" can restore it
 * for 30 days. A shared day comes down in the same step, but only when the
 * browser says it asked: `{ "takeDown": true }`, which the confirm sends only
 * after naming the consequence. Without it a shared day is refused, so a
 * confirm that believed it was deleting a draft can never take one down.
 *
 * Refused, with nothing moved, while a postcard not yet sent — or sent and
 * still in flight (`submitted`) — uses one of the day's photographs, and while
 * a paid photobook not yet rendered (`submitted`) names one: both would print
 * a photograph that is no longer there, the book as a crossed box
 * (`drawMissing`). An unpaid photobook draft naming one only needs the owner
 * to have been told: `{ "acceptPhotobookGaps": true }`, sent after the
 * confirm shows the warning; without it the answer is 409
 * `photobook_draft_uses_day`. Matched with `photobookPhotoRefs`, the same
 * reading the reshape sweep uses.
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "This is the owner's own door, from a browser. An agent deletes a draft with " +
          "DELETE /api/v2/{user}/trips/{trip}/days/{slug}.",
      },
      { status: 403 },
    );
  }
  if (foreignOrigin(request)) {
    return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  }

  const { user, trip: tripId, slug } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (!readTripFile(user, tripId)) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const stem = resolveDayStem(user, tripId, slug);
  const day = stem ? readDayFile(user, tripId, stem) : null;
  if (!stem || !day) return Response.json({ error: "unknown_day" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { takeDown?: unknown; acceptPhotobookGaps?: unknown };
  if (day.status === "published" && body?.takeDown !== true) {
    return Response.json(
      {
        error: "published_needs_take_down",
        message: "This day is on the site. Deleting it takes it down too, so the request must say takeDown: true. Nothing was changed.",
      },
      { status: 409 },
    );
  }

  const bare = stem.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const ref = tripRef(user, tripId);
  const card = (await listPostcardOrders(user)).find(
    (o) =>
      ((isPending(o) && !isExpired(o)) || o.status === "submitted") &&
      o.payload.trip === ref &&
      (o.payload.day === stem || o.payload.day === bare || o.payload.photo.startsWith(`${bare}/`)),
  );
  if (card) {
    return Response.json(
      {
        error: "used_by_postcard",
        message: "A postcard you have not sent yet uses a photograph from this day. Send or delete that card first. Nothing was deleted.",
        href: `/${user}/postcards/${card.id}`,
      },
      { status: 409 },
    );
  }

  const fromDay = (options: Parameters<typeof photobookPhotoRefs>[0]) =>
    photobookPhotoRefs(options).some((src) => src.includes(`/media/${tripId}/${bare}/`));
  const book = (await listPhotobookOrders(user)).find((o) => o.status === "submitted" && o.payload.trip === ref && fromDay(o.payload.options));
  if (book) {
    return Response.json(
      {
        error: "used_by_photobook_order",
        message: "A photobook you ordered and that is still being made uses photographs from this day. Wait until it is built. Nothing was deleted.",
        href: `/${user}/photobooks/${book.id}`,
      },
      { status: 409 },
    );
  }
  if (body?.acceptPhotobookGaps !== true && (await listDrafts(user)).some((d) => d.trip === ref && fromDay(d.options))) {
    return Response.json(
      {
        error: "photobook_draft_uses_day",
        message: "A photobook draft uses photographs from this day; they will be missing from it. Send acceptPhotobookGaps: true to delete anyway. Nothing was deleted.",
      },
      { status: 409 },
    );
  }

  const trashed = trashDay(user, tripId, stem);
  if (!trashed.ok) {
    return Response.json({ error: trashed.error, message: trashed.message }, { status: trashed.error === "unknown_day" ? 404 : 409 });
  }
  return Response.json({ ok: true, id: trashed.id, trip: tripId, slug: stem, wasPublished: day.status === "published", keptDays: TRASH_DAYS });
}
