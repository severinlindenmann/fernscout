// POST /api/v2/{user}/trips/{trip}/travellers/from-photo — ports
// app/api/v1/[user]/trips/[trip]/travellers/from-photo/route.ts onto the v2
// plumbing. Domain logic (classifyTravellers) is unchanged.
//
// Not ported: the idempotency-key replay guard v1 carried
// (lib/idempotency.ts). No other v2 route that spends credits uses it —
// POST .../days/{slug}/send charges for WhatsApp the same way, with no
// idempotency key — so this stays consistent with the rest of the v2
// surface rather than being the one route that reaches for a mechanism no
// sibling route uses. Add it back here (and to `send`) together if a
// retried spend turns out to matter in practice.
//
// The response shape also differs from v1's: v2 figures are a named
// journal-level library (PUT /api/v2/{user}/figures/{id}) referenced by a
// trip's own `figures: {mode, figures: [ids]}` rather than a raw `party`
// embedded on the trip, so the `next` note below points at that door
// instead of v1's now-gone `PATCH .../travellers`.
import { mayWriteTrip, refuseWrite } from "@/lib/api/auth";
import { outOfScopeRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { isEnabled } from "@/lib/capabilities";
import { refund, spend } from "@/lib/credits";
import { hasHelperConsent } from "@/lib/helper/consent";
import {
  classifyTravellers,
  HELPER_PROVIDER,
  TRAVELLERS_FROM_PHOTO_CREDITS,
  type PhotoImage,
} from "@/lib/helper/model";
import { findInboxFile } from "@/lib/inbox";
import { resizedBuffer, resizedCopy, resolveMediaFile } from "@/lib/media";
import { mediaKey } from "@/lib/photos";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { renderPartySvg } from "@/lib/travellers/render";
import { getTrip, tripRef } from "@/lib/trips";
import { IMAGE_MAX_BYTES } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

/** One classification a quarter-hour, per address — an occasional call on
 *  one photograph, not a batch job. Same budget as the v1 route. */
const LIMIT = { max: 15, windowMs: 15 * 60 * 1000 };

/** Plenty for a model to read faces, hair and clothing. */
const PHOTO_WIDTH = 1080;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read a party off a group photograph instead of asking forty questions
 * about it — B1517. **Proposed, never written**: the response is a party in
 * the same shape `PATCH .../travellers` accepts, and an owner decides
 * whether to send it. See the v1 route this replaces for the full reasoning
 * — no `for`, no name, a child classified exactly like everybody else in
 * the frame, and a field the photograph does not answer comes back absent
 * in `unanswerable` rather than guessed.
 *
 * The photograph must already belong to this journal: multipart bytes under
 * `photo`, an `inbox` id, or a `gallery` src already on this trip. There is
 * no fourth door that fetches a URL, unlike `POST .../media` — this call
 * would otherwise point a model at an arbitrary stranger's photograph.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/travellers/from-photo">,
) {
  const { user, trip } = await params;
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
  const gate = await mayWriteTrip(bearer.session, found);
  // See the media/duplicates route this pattern is shared with: a
  // trip-scoped token naming a different trip must answer the same
  // unknown_trip 404 as an unknown trip, not a 403 that confirms this trip
  // exists.
  if (!gate.ok) return refuseWrite(gate);

  if (!isEnabled("helper", user)) {
    return fail("helper_unavailable", ERROR_CODES.helper_unavailable, undefined, 404);
  }

  const limited = rateLimitFor("travellers-from-photo", clientIp(request), LIMIT);
  if (!limited.ok) {
    return fail("too_many_requests", ERROR_CODES.too_many_requests, undefined, 429);
  }

  // A photograph of people is the most sensitive thing this product
  // handles — asked for on its own, before anything about the photograph
  // itself is even read.
  if (!hasHelperConsent(user, "photos")) {
    return fail("consent_required", ERROR_CODES.consent_required, undefined, 403);
  }

  const isMultipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");

  let bytes: Buffer;

  if (isMultipart) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("photo");
    if (!form || !(file instanceof File)) {
      return fail("expected_photo", ERROR_CODES.expected_photo, undefined, 400);
    }
    if (file.size > IMAGE_MAX_BYTES) {
      return fail(
        "invalid_media",
        `${(file.size / 1024 / 1024).toFixed(1)} MB is over the ${IMAGE_MAX_BYTES / 1024 / 1024} MB a photograph may be.`,
        undefined,
        400,
      );
    }
    bytes = Buffer.from(await file.arrayBuffer());
  } else {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("invalid_json", ERROR_CODES.invalid_json, undefined, 400);

    const inboxId = text(body.inbox);
    const gallerySrc = text(body.gallery);
    if (!inboxId && !gallerySrc) {
      return fail("expected_photo", ERROR_CODES.expected_photo, undefined, 400);
    }

    if (inboxId) {
      // Scoped to this journal by construction: `findInboxFile` only ever
      // looks inside this journal's own inbox.
      const staged = findInboxFile(user, inboxId);
      if (!staged || staged.entry.kind !== "media") {
        return fail("unknown_inbox_file", ERROR_CODES.unknown_inbox_file, undefined, 400);
      }
      const resized = await resizedCopy(staged.file, PHOTO_WIDTH);
      if (!resized) {
        return fail("invalid_media", `"${inboxId}" could not be read as a photograph.`, undefined, 400);
      }
      bytes = resized;
    } else {
      // The trip in the URL, never the trip named inside the src — a src
      // pointing at a different trip must not resolve here.
      const segments = mediaKey(gallerySrc).split("/").filter(Boolean);
      if (segments[0] !== trip) {
        return fail(
          "not_this_trip",
          `"${gallerySrc}" is not a photograph on this trip's own media. Give a src exactly ` +
            "as a day's gallery already carries it.",
          undefined,
          400,
        );
      }
      const file = resolveMediaFile(user, segments);
      if (!file) {
        return fail("not_this_trip", `"${gallerySrc}" is not a file in this trip's media.`, undefined, 400);
      }
      const resized = await resizedCopy(file, PHOTO_WIDTH);
      if (!resized) {
        return fail("invalid_media", `"${gallerySrc}" could not be read as a photograph.`, undefined, 400);
      }
      bytes = resized;
    }
  }

  // A freshly uploaded photograph is resized in memory and never lands on
  // disk at all.
  const image = isMultipart ? await resizedBuffer(bytes, PHOTO_WIDTH) : bytes;
  if (!image) {
    return fail("invalid_media", "That could not be read as a photograph.", undefined, 400);
  }
  const photo: PhotoImage = { base64: image.toString("base64"), mediaType: "image/webp" };

  const ledgerRef = `${user}/${trip}/from-photo`;
  if (!(await spend(user, TRAVELLERS_FROM_PHOTO_CREDITS, "travellers_from_photo", ledgerRef))) {
    return fail("no_credits", ERROR_CODES.no_credits, undefined, 402);
  }

  try {
    const results = await classifyTravellers(photo, user);
    const party = results.map((r) => r.figure);
    return ok({
      ok: true,
      figures: results.map((r, index) => ({ position: index, figure: r.figure, unanswerable: r.unanswerable })),
      party,
      preview: renderPartySvg(party),
      spent: TRAVELLERS_FROM_PHOTO_CREDITS,
      provider: HELPER_PROVIDER,
      note:
        "Nothing was written. Show this to the owner and, for each figure they agree looks " +
        `like somebody, PUT /api/v2/${user}/figures/<id> with it as the whole figure — then ` +
        `name the ones this trip should draw with PATCH /api/v2/${user}/trips/${trip} ` +
        '`{"figures": {"mode": "custom", "figures": [ids]}}`. Fields not listed in a figure ' +
        "were not answered by the photograph — see that figure's own `unanswerable` — and " +
        "are left for a person to fill in rather than guessed.",
    });
  } catch {
    await refund(user, TRAVELLERS_FROM_PHOTO_CREDITS, ledgerRef);
    return fail("model_failed", ERROR_CODES.model_failed, undefined, 502);
  }
}
