import { isEnabled } from "@/lib/capabilities";
import { DESCRIBE_PHOTO_WIDTH } from "@/lib/helper/limits";
import { checkAiDay, recordAiDay } from "@paid/billing/lib/aiDays";
import { hasHelperConsent } from "@/lib/helper/consent";
import { readReceipt, HELPER_PROVIDER, type PhotoImage } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { resizedCopy, resolveMediaFile } from "@/lib/media";
import { mediaKey } from "@/lib/photos";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * "Read a receipt" — TIX-2's add-a-day flow, a photograph in, a printed
 * total out. The same shape as `describe-photos/route.ts` next door: cookie
 * only and bearer refused (`isHelperOwner`), a 404 rather than a 500 with the
 * capability off, and a gate order that runs cheapest-first so the expensive
 * step is the only one that can fail after money has moved.
 *
 * **Nothing here writes a cost to the day.** It returns one receipt (or
 * `null`) for the owner to read, edit or discard — the day's own costs are
 * kept by the existing `day/costs` writer, never by this route on its own
 * say-so.
 *
 * A derivative goes to the model, never the original — the same
 * `resizedCopy` `describe-photos` already sends.
 */

/** Ten receipts in a quarter hour would already be an unusual day; a brake
 *  on a script, not the quota — the AI-day gate is the quota. */
const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/read-receipt">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-read-receipt", clientIp(request), LIMIT);
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
  const src = text(body.src);
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });

  const item = entry.gallery.find((g) => g.src === src && g.type === "image");
  if (!item) return Response.json({ error: "not_on_day" }, { status: 404 });

  if (!hasHelperConsent(user, "photos")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const segments = mediaKey(item.src).split("/");
  const file = resolveMediaFile(user, segments);
  if (!file) return Response.json({ error: "not_on_day" }, { status: 404 });

  const gate = await checkAiDay(user, tripId, entry.date);
  if (!gate.ok) return Response.json(gate.refusal, { status: 402 });

  try {
    const resized = await resizedCopy(file, DESCRIBE_PHOTO_WIDTH);
    if (!resized) throw new Error("the photograph could not be resized");
    const image: PhotoImage = { base64: resized.toString("base64"), mediaType: "image/webp" };
    const receipt = await readReceipt(image, user);
    await recordAiDay(user, tripId, entry.date);
    return Response.json({ ok: true, receipt, provider: HELPER_PROVIDER });
  } catch {
    // "A failed AI call uses no day" — nothing was recorded. What a provider
    // says when it is unhappy is not something to render on somebody's phone.
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
}
