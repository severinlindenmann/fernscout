import { authenticate, errorResponse, mayWriteTrip, outOfScope, ownsUser, refuseWrite } from "@/lib/api/auth";
import { isEnabled } from "@/lib/capabilities";
import { refund, spend } from "@/lib/credits";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
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

/**
 * `POST /api/v1/<user>/trips/<trip>/travellers/from-photo` — read a party off
 * a group photograph, instead of asking forty questions about it — B1517.
 *
 * **Proposed, never written.** The response is a party in the same shape
 * `GET .../travellers` reads back, plus the preview `GET .../figures/preview`
 * already draws — an owner looks at the picture and decides whether to `PATCH
 * .../travellers` with it. This call cannot write that block itself, on
 * purpose: an inferred face becoming a written fact about a person is exactly
 * what AGENTS.md's rule on invented memory covers, and a good guess is still
 * a guess.
 *
 * **The photograph has to already belong to this journal.** Three doors, the
 * same three `POST .../media` takes: multipart bytes under `photo`, an
 * `inbox` id already staged for this journal, or a `gallery` src already on
 * this trip. There is no fourth door that fetches a URL — unlike `.../media`,
 * which stores what it fetches, this call would otherwise be a way to point a
 * model at an arbitrary photograph of an arbitrary stranger and have it
 * export the result on this journal's ledger. Nothing sent here is kept: a
 * fresh upload is resized in memory and never written to disk; an inbox file
 * or a gallery photograph was already on this journal before this call and is
 * read exactly as it stands.
 *
 * **No `for`, and no name.** The classifier (`classifyTravellers` in
 * lib/helper/model.ts) has no field for it and no vocabulary for a name at
 * all — matching a face to somebody in `people:` is a decision this route
 * cannot make even if asked to.
 *
 * **A field the photograph does not answer comes back absent, not guessed**,
 * and `unanswerable` names which ones, per figure — computed from what the
 * model actually left empty, never taken on its own say-so.
 *
 * **A child in the frame is classified exactly like everybody else in it** —
 * the same four broad age buckets, nothing more specific, and never a guess
 * at who they are. See the system prompt in lib/helper/model.ts.
 *
 * Costs `TRAVELLERS_FROM_PHOTO_CREDITS`, charged once whatever the party's
 * size (a family of four is the case this exists for), refunded if the model
 * call fails.
 */

/** One classification a quarter-hour, per address — this is an occasional
 *  call on one photograph, not a batch job. */
const LIMIT = { max: 15, windowMs: 15 * 60 * 1000 };

/** Plenty for a model to read faces, hair and clothing; the print-resolution
 *  original buys nothing more here than it does for `describe_photos`. */
const PHOTO_WIDTH = 1080;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/travellers/from-photo">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip } = await params;
  if (!ownsUser(auth.session, user)) {
    return outOfScope(auth.session, user);
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  if (!isEnabled("helper", user)) {
    return Response.json(
      {
        error: "helper_unavailable",
        message: "This journal has no model-backed features switched on, so there is nothing to read a photograph with.",
      },
      { status: 404 },
    );
  }

  const limited = rateLimitFor("travellers-from-photo", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  // A photograph of people is the most sensitive thing this product handles
  // — asked for on its own, the same scope `describe_photos` asks for, and
  // before anything about the photograph itself is even read.
  if (!hasHelperConsent(user, "photos")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const isMultipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");

  let bytes: Buffer;
  let idempotencySource: unknown;
  let supplied = "";

  if (isMultipart) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("photo");
    if (!form || !(file instanceof File)) {
      return Response.json(
        {
          error: "expected_photo",
          message:
            'Send one photograph — multipart/form-data with the file under "photo", or ' +
            'application/json with {"inbox": "<id>"} or {"gallery": "/media/…"}.',
        },
        { status: 400 },
      );
    }
    if (file.size > IMAGE_MAX_BYTES) {
      return Response.json(
        {
          error: "invalid_media",
          message: `${(file.size / 1024 / 1024).toFixed(1)} MB is over the ${IMAGE_MAX_BYTES / 1024 / 1024} MB a photograph may be.`,
        },
        { status: 400 },
      );
    }
    bytes = Buffer.from(await file.arrayBuffer());
    idempotencySource = { name: file.name, size: file.size };
    supplied = text(form.get("idempotency_key"));
  } else {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

    const inboxId = text(body.inbox);
    const gallerySrc = text(body.gallery);
    supplied = text(body.idempotency_key);
    if (!inboxId && !gallerySrc) {
      return Response.json(
        {
          error: "expected_photo",
          message:
            'Send {"inbox": "<id>"} for a file staged in this journal\'s inbox, {"gallery": ' +
            '"/media/…"} for a photograph already on this trip, or multipart bytes under "photo".',
        },
        { status: 400 },
      );
    }

    if (inboxId) {
      // Scoped to this journal by construction: `findInboxFile` only ever
      // looks inside `inboxDir(user, …)`, so an id from a different journal's
      // bucket resolves to nothing.
      const staged = findInboxFile(user, inboxId);
      if (!staged || staged.entry.kind !== "media") {
        return Response.json(
          {
            error: "unknown_inbox_file",
            message:
              `"${inboxId}" is not a photograph staged in this journal's inbox. GET ` +
              `/api/v1/${user}/inbox for what is there.`,
          },
          { status: 400 },
        );
      }
      const resized = await resizedCopy(staged.file, PHOTO_WIDTH);
      if (!resized) {
        return Response.json(
          { error: "invalid_media", message: `"${inboxId}" could not be read as a photograph.` },
          { status: 400 },
        );
      }
      bytes = resized;
      idempotencySource = { inbox: inboxId };
    } else {
      // The trip in the URL, never the trip named inside the src — a src
      // pointing at a *different* trip in this journal must not resolve
      // here, or this call would read any photograph in the journal under
      // the guise of "already on this trip".
      const segments = mediaKey(gallerySrc).split("/").filter(Boolean);
      if (segments[0] !== trip) {
        return Response.json(
          {
            error: "not_this_trip",
            message:
              `"${gallerySrc}" is not a photograph on this trip's own media. Give a src exactly ` +
              "as a day's gallery already carries it.",
          },
          { status: 400 },
        );
      }
      const file = resolveMediaFile(user, segments);
      if (!file) {
        return Response.json(
          { error: "not_this_trip", message: `"${gallerySrc}" is not a file in this trip's media.` },
          { status: 400 },
        );
      }
      const resized = await resizedCopy(file, PHOTO_WIDTH);
      if (!resized) {
        return Response.json(
          { error: "invalid_media", message: `"${gallerySrc}" could not be read as a photograph.` },
          { status: 400 },
        );
      }
      bytes = resized;
      idempotencySource = { gallery: gallerySrc };
    }
  }

  const key = supplied === "" ? null : idempotencyKey(user, "travellers.from-photo", supplied);
  const fingerprint = fingerprintOf({ trip, source: idempotencySource });
  const recalled = await recall<Record<string, unknown>>(key, fingerprint);
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  // A freshly uploaded photograph is resized in memory and never lands on
  // disk at all — nothing here is kept beyond the length of this request.
  const image = isMultipart ? await resizedBuffer(bytes, PHOTO_WIDTH) : bytes;
  if (!image) {
    return Response.json(
      { error: "invalid_media", message: "That could not be read as a photograph." },
      { status: 400 },
    );
  }
  const photo: PhotoImage = { base64: image.toString("base64"), mediaType: "image/webp" };

  const ledgerRef = `${user}/${trip}/from-photo`;
  if (!(await spend(user, TRAVELLERS_FROM_PHOTO_CREDITS, "travellers_from_photo", ledgerRef))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  try {
    const results = await classifyTravellers(photo, user);
    const party = results.map((r) => r.figure);
    const answer = {
      ok: true,
      // Ordered left to right in the photograph, and that order is each
      // figure's index here — the "which face became which figure" the
      // ticket asks for.
      figures: results.map((r, index) => ({ position: index, figure: r.figure, unanswerable: r.unanswerable })),
      party,
      preview: renderPartySvg(party),
      spent: TRAVELLERS_FROM_PHOTO_CREDITS,
      provider: HELPER_PROVIDER,
      note:
        "Nothing was written. Show this to the owner and, if they agree it looks like " +
        `them, PATCH /api/v1/${user}/trips/${trip}/travellers with \`party\` as the whole ` +
        "travellers block. Fields not listed in a figure were not answered by the " +
        "photograph — see that figure's own `unanswerable` — and are left for a person to " +
        "fill in rather than guessed.",
    };
    await remember(key, fingerprint, answer);
    return Response.json(answer);
  } catch {
    await refund(user, TRAVELLERS_FROM_PHOTO_CREDITS, ledgerRef);
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
}
