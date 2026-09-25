import path from "node:path";
import { isEnabled } from "@/lib/capabilities";
import { creditsForPhotos, DESCRIBE_PHOTO_WIDTH } from "@/lib/helper/credits";
import { refund, spend } from "@/lib/credits";
import { hasHelperConsent } from "@/lib/helper/consent";
import { describeImage, HELPER_MODEL, HELPER_PROVIDER, type PhotoImage } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { defaultLocaleFor, localesFor } from "@/lib/locales";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { AS_AUTHOR, forgetEntries, getEntryBySlug } from "@/lib/entries";
import { resizedCopy, resolveMediaFile, tripMediaDir } from "@/lib/media";
import { describedBlock, describedFor, readTripSidecar, writeTripSidecar } from "@/lib/sidecar";
import { mediaKey } from "@/lib/photos";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { readJsonBody } from "@/lib/api/jsonBody";

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
 * **Every gallery item gets a row, photograph or not** — B873. A video is
 * never sent to the model (nothing should be invented from a poster frame),
 * but its row still comes back, marked `skipped: "video"` with an empty
 * caption, so a mixed day is never answered with fewer rows than tiles and a
 * reader has no explanation for the gap.
 *
 * **A photograph is described once.** The answer is kept in the photograph's
 * own sidecar under `described` (B1866), keyed on the hash of the derivative
 * that was actually sent; a second ask for the same day reads it back, sends
 * nothing and spends nothing. Credits are priced on the photographs with no
 * stored answer, so a day of twelve where eleven are already described costs
 * one credit's worth of one picture rather than two of twelve.
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

/** How many photographs are described at once. */
const POOL = 3;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/describe-photos">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
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

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip);
  const slug = text(body.slug);
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });

  const gallery = entry.gallery;
  // Kept as gallery-index pairs, not a plain filter, so a caption or a
  // `skipped` mark can be written back to the item's own position below —
  // B873, a day of two photographs and one video answered with two caption
  // rows and no mention of the third.
  const photoEntries = gallery
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === "image");
  if (photoEntries.length === 0) return Response.json({ error: "no_photos" }, { status: 400 });

  // Before the spend, and before consent even: naming photographs is the
  // bigger promise, and a person who has only ever agreed to "your words"
  // must be asked again — B687's whole reason for existing.
  if (!hasHelperConsent(user, "photos")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const srcs = photoEntries.map(({ item }) => item.src);
  const supplied = text(body.idempotency_key);
  const key = supplied === "" ? null : idempotencyKey(user, "helper.describe-photos", supplied);
  const fingerprint = fingerprintOf({ slug, srcs });
  const recalled = await recall<Record<string, unknown>>(key, fingerprint);
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  const locales = localesFor(user);
  const mediaRoot = tripMediaDir(ref);

  // Resolved per photograph before anything is priced, because the price is
  // "how many of these are not already described". A file that will not
  // resolve or resize (an unreadable image, something already deleted from
  // disk) is answered with an empty caption rather than failing the whole
  // day over one picture — and is not charged for either.
  const resolved: { index: number; file: string; relPath: string }[] = [];
  for (const { item, index } of photoEntries) {
    const segments = mediaKey(item.src).split("/");
    const file = resolveMediaFile(user, segments);
    if (file) resolved.push({ index, file, relPath: path.relative(mediaRoot, file) });
  }

  // The captions this answers with, by gallery index — filled from the
  // sidecar here and from the model below.
  const described = new Map<number, string>();
  const locale = defaultLocaleFor(user);
  const uncached: typeof resolved = [];
  for (const photo of resolved) {
    const block = describedFor(readTripSidecar(ref, photo.relPath), photo.file, locales);
    if (block) described.set(photo.index, block.caption[locale] ?? "");
    else uncached.push(photo);
  }
  const cached = described.size;

  // Priced on what actually has to be sent. All cached is zero, and zero is
  // not a spend at all: a ledger row for nothing would be a lie about the
  // balance, and `spend` would refuse the fraction anyway.
  const credits = creditsForPhotos(uncached.length);
  const ledgerRef = `${user}/${tripId}/${slug}`;
  if (credits > 0 && !(await spend(user, credits, "helper", ledgerRef))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  try {
    // Three at a time: enough to hide the latency of a day's worth of
    // pictures, small enough that a slow provider is not hit with twelve
    // requests at once. Each answer is written to its own sidecar the moment
    // it arrives, so a throw part-way through still leaves everything
    // already described cached and free next time.
    // Counts only photographs actually sent to the model — B1795. A resize
    // failure returns quietly rather than throwing (one bad file must not
    // fail the whole day), so a whole batch of resize failures would
    // otherwise leave the loop below running to completion with nothing
    // described and nothing thrown: the spend above would stand for a
    // request that asked the model nothing.
    let sent = 0;
    for (let i = 0; i < uncached.length; i += POOL) {
      const results = await Promise.allSettled(
        uncached.slice(i, i + POOL).map(async (photo) => {
          const resized = await resizedCopy(photo.file, DESCRIBE_PHOTO_WIDTH);
          if (!resized) return;
          const image: PhotoImage = { base64: resized.toString("base64"), mediaType: "image/webp" };
          const form = await describeImage(image, user, locales);
          writeTripSidecar(ref, photo.relPath, {
            described: describedBlock(form, HELPER_MODEL, photo.file),
          });
          described.set(photo.index, form.caption[locale] ?? "");
          sent += 1;
        }),
      );
      // `allSettled` rather than `all` so a sibling that also fails does not
      // become an unhandled rejection; the first failure is still the one
      // this request answers with, and the refund below is unconditional.
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;
    }
    // Every photograph that needed sending failed to resize: the model was
    // never asked anything, so the spend above bought nothing. Thrown, not
    // returned directly, so it takes the same refund path a model failure
    // already does — one policy, whichever reason nothing got described.
    if (uncached.length > 0 && sent === 0) {
      throw new Error("every photograph failed to resize");
    }
    // The gallery reads `alt` off these sidecars (B1867), and the entry cache
    // is keyed on the entry files alone — a sidecar written beside an
    // unchanged day would otherwise stay invisible until the day is next
    // edited or the process restarts.
    if (uncached.length > 0) forgetEntries(ref);

    // Every gallery item gets a row — a video is never sent for description
    // (nothing should be invented from a poster frame), but it is named
    // rather than silently dropped, so a person or an agent matching
    // captions to tiles by position never pairs the wrong text with the
    // wrong picture. B873.
    const bySrc = gallery.map((item, index) => ({
      src: item.src,
      caption: described.get(index) ?? "",
      ...(item.type === "video" ? { skipped: "video" as const } : {}),
    }));

    const answer = {
      ok: true,
      captions: bySrc,
      spent: credits,
      cached,
      provider: HELPER_PROVIDER,
    };
    await remember(key, fingerprint, answer);
    return Response.json(answer);
  } catch {
    // The credit bought nothing; give it back. The whole spend goes back even
    // when some photographs were described before the throw, because the
    // spend was priced whole — and those photographs are cached now, so the
    // retry pays for the ones that are genuinely still missing and nothing
    // more. What a provider says when it is unhappy is not something to
    // render on somebody's phone.
    if (credits > 0) await refund(user, credits, ledgerRef);
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
}
