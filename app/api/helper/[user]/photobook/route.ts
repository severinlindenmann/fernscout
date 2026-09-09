import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { BOOK_SIZES, COVER_TYPES, type CoverType } from "@/lib/photobook/spec";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The photobook link the conversation confirmed — `photobook` in
 * `lib/helper/tools/areas/printed.ts`.
 *
 * **There is nothing to write.** Unlike a postcard, a photobook has no order
 * ahead of its own maker: planning a book, pricing it and paying for it are
 * one page and one press (`app/[user]/photobook/order/route.ts`), owner-only
 * and outside `/api/v1` for the same reason that route gives at length. So
 * this route's whole job is to check the trip and the two choices are real,
 * and hand back the URL of that page — the size and cover travel along only
 * so the sentence that led here can name them; the maker itself still asks
 * before anything is built.
 */

const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/photobook">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  // No `isEnabled("helper", …)` gate — see the same note in the postcard
  // route beside this one: nothing here calls a model or spends a credit.
  if (!isEnabled("photobook", user)) {
    refused(user, "photobook", "photobook_disabled");
    return Response.json({ error: "photobook_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-photobook", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip);
  const trip = tripId ? getTrip(tripRef(user, tripId)) : undefined;
  if (!trip) {
    refused(user, "photobook", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const sizeId = text(body.size);
  const size = BOOK_SIZES[sizeId];
  if (!size) {
    refused(user, "photobook", "invalid_request");
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const cover = text(body.cover) as CoverType;
  if (!(COVER_TYPES as readonly string[]).includes(cover) || !size.covers[cover]) {
    refused(user, "photobook", "invalid_request");
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  wrote(user, "photobook", { trip: trip.id, size: sizeId, cover });

  return Response.json(
    {
      ok: true,
      url: `${serverSite().url}/${user}/trips/${trip.id}/photobook`,
      size: sizeId,
      cover,
      next: "Nothing has been built or charged. Ask the owner to open the URL to lay out and pay for the book.",
    },
    { status: 201 },
  );
}
