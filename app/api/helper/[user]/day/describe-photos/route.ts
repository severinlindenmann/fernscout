import { isEnabled } from "@/lib/capabilities";
import { creditsForPhotos } from "@/lib/helper/credits";
import { refund, spend } from "@/lib/credits";
import { hasHelperConsent } from "@/lib/helper/consent";
import { describePhotos, HELPER_PROVIDER, type PhotoImage } from "@/lib/helper/model";
import { isHelperOwner } from "@/lib/helper/server";
import { defaultLocaleFor } from "@/lib/locales";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { resizedCopy, resolveMediaFile } from "@/lib/media";
import { mediaKey } from "@/lib/photos";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Photographs in, captions to read — B687.
 *
 * The same shape as `write-day/route.ts` next door, and for the same reasons:
 * cookie only and bearer refused (`isHelperOwner`), a 404 rather than a 500
 * with the capability off, and a gate order that runs cheapest-first so the
 * expensive step is the only one that can fail after money has moved.
 *
 * **Nothing here writes a caption to the day.** It returns suggestions,
 * `{ src, caption }` for every photograph asked about, and the existing media
 * `PATCH` is what a person uses to keep one — the same "review, then keep or
 * discard" shape `write-day` already uses for prose, applied here to a
 * caption per picture instead of one paragraph.
 *
 * **A derivative goes to the model, never the original.** `resizedCopy` is
 * the same resize the browser's own gallery reads through
 * `app/[user]/media/[...path]/route.ts`; sending a print-resolution original
 * down the wire to a model that only needs to describe what is in frame would
 * be waste for no better an answer.
 */

/** Ten write-ups' worth of photographs would already be an unusual day; this
 *  is a brake on a script, not the quota — the credit is the quota. */
const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

/** The widest of `MEDIA_WIDTHS` short of the full 2000px original — plenty for
 *  a model to read a scene, at a fraction of the bytes. */
const PHOTO_WIDTH = 1080;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/describe-photos">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return Response.json({ error: "not_your_journal" }, { status: 404 });
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-describe-photos", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip);
  const slug = text(body.slug);
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });

  const photos = entry.gallery.filter((item) => item.type === "image");
  if (photos.length === 0) return Response.json({ error: "no_photos" }, { status: 400 });

  // Before the spend, and before consent even: naming photographs is the
  // bigger promise, and a person who has only ever agreed to "your words"
  // must be asked again — B687's whole reason for existing.
  if (!hasHelperConsent(user, "photos")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const srcs = photos.map((item) => item.src);
  const supplied = text(body.idempotency_key);
  const key = supplied === "" ? null : idempotencyKey(user, "helper.describe-photos", supplied);
  const fingerprint = fingerprintOf({ slug, srcs });
  const recalled = recall<Record<string, unknown>>(key, fingerprint);
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  const credits = creditsForPhotos(photos.length);
  const ledgerRef = `${user}/${tripId}/${slug}`;
  if (!(await spend(user, credits, "helper", ledgerRef))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  try {
    // Resolved and resized per photograph. A file that will not resize (an
    // unreadable image, something already deleted from disk) is answered with
    // an empty caption rather than failing the whole batch over one picture.
    const sendable: { index: number; image: PhotoImage }[] = [];
    for (const [index, item] of photos.entries()) {
      const segments = mediaKey(item.src).split("/");
      const file = resolveMediaFile(user, segments);
      const resized = file ? await resizedCopy(file, PHOTO_WIDTH) : null;
      if (resized) {
        sendable.push({ index, image: { base64: resized.toString("base64"), mediaType: "image/webp" } });
      }
    }

    const captions =
      sendable.length > 0
        ? await describePhotos(
            sendable.map((s) => s.image),
            user,
            defaultLocaleFor(user),
          )
        : [];
    const bySrc = photos.map((item) => ({ src: item.src, caption: "" }));
    sendable.forEach((sent, i) => {
      bySrc[sent.index].caption = captions[i] ?? "";
    });

    const answer = { ok: true, captions: bySrc, spent: credits, provider: HELPER_PROVIDER };
    remember(key, fingerprint, answer);
    return Response.json(answer);
  } catch {
    // The credit bought nothing; give it back. What a provider says when it
    // is unhappy is not something to render on somebody's phone.
    await refund(user, credits, ledgerRef);
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
}
