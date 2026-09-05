import { isOwner } from "@/lib/contacts/session";
import { isEnabled } from "@/lib/capabilities";
import { parseOptions } from "@/lib/photobook/options";
import { planFor, priceOf } from "@/lib/photobook/build";
import { renderPreview } from "@/lib/photobook/preview";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { parseTripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The preview, planned server-side because the planner lives here.
 *
 * Outside `/api/v1/` and satisfied only by the owner's cookie, for the same
 * three reasons `app/[user]/postcards/[id]/send/route.ts` states: the agent
 * namespace is documented elsewhere, `isOwner` is called *without* the request
 * so a bearer token cannot satisfy it, and a request carrying one is refused
 * with a sentence rather than a bare 403 it might retry around. This route
 * charges nothing, but it plans the same book the paying one does, and the two
 * must not disagree about who is allowed to ask.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/photobook/preview">,
) {
  const { user } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "A photobook is configured and paid for by the person whose journal it is. " +
          "Nothing here answers to a token — give them the URL of the options page instead.",
      },
      { status: 403 },
    );
  }
  if (!isEnabled("photobook", user) || !(await isOwner(user))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { trip?: unknown; options?: unknown }
    | null;
  const trip = typeof body?.trip === "string" ? body.trip : "";
  const parsed = parseTripRef(trip);
  const options = parseOptions(body?.options, Object.keys(BOOK_SIZES));
  if (!parsed || parsed.username !== user || !options) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // `planFor` reads the trip off disk and throws if the ref does not resolve
  // to one — a stale page (the trip was deleted mid-session) or a malformed
  // one that happened to parse. Either way the honest answer to the browser
  // is the same "not found" as an unparseable ref, not a 500.
  let book;
  try {
    book = planFor(trip, options);
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const html = renderPreview(
    book,
    "",
    (file) => file,
    // `BookPhoto.webSrc` is set from the entry's own gallery `src`, which
    // `lib/entries.ts` already ran through `mediaWithOwner` — it is a
    // complete, owner-prefixed URL (`/alex/media/asia-2026/day-one/01.jpg`),
    // exactly the shape `app/[user]/media/[...path]/route.ts` serves. Used
    // as-is: prefixing it again with the username produces `/alex/alex/…`
    // and every image 404s. `BookPhoto.file` is not this — for a trip with
    // kept originals it carries an `originals:` prefix the web server does
    // not serve at all.
    (photo) => photo.webSrc ?? "",
  );

  return Response.json({
    html,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
    credits: priceOf(book, options),
    warnings: book.warnings,
  });
}
