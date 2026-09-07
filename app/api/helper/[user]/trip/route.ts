import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { createTrip, DATE_RE } from "@/lib/tripWrite";

export const dynamic = "force-dynamic";

/**
 * The trip the person confirmed — B685.
 *
 * The router can propose a trip; only this can make one, and it is reached
 * only by somebody pressing a button with the title and the two dates in front
 * of them. **No model is spoken to here**: the fields arrive from the form,
 * which is the whole discipline — the model routed, a person confirmed, and
 * `createTrip` is the same function `POST /api/v1/<user>/trips` calls, so a
 * trip made this way is a trip made any other way.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, for the reason `app/api/helper/[user]/day/route.ts` sets out at
 * length: the browser has a cookie and the contract's routes take a bearer
 * token, and putting a seven-day write token into a page is the thing B283
 * exists to avoid.
 *
 * The id is derived rather than asked for. It becomes part of a URL and a
 * folder name, and it is the one field of the four that somebody filling in a
 * box on a phone has no way to have an opinion about.
 */

const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A title and a year into something that ages well as a URL. */
function idFrom(username: string, title: string, start: string): string {
  const base =
    `${title}-${start.slice(0, 4)}`
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `trip-${start.slice(0, 4)}`;
  let id = base;
  for (let n = 2; getTrip(tripRef(username, id)); n += 1) id = `${base}-${n}`;
  return id;
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/trip">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-trip", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const title = text(body.title);
  const start = text(body.start);
  const end = text(body.end);
  if (!title || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return Response.json({ error: "invalid_trip" }, { status: 400 });
  }

  const created = createTrip(user, { id: idFrom(user, title, start), title, start, end });
  if (!created.ok) {
    return Response.json({ error: created.error, message: created.message }, { status: 400 });
  }
  return Response.json(
    { ok: true, id: created.id, href: `/${encodeURIComponent(user)}/trips/${created.id}` },
    { status: 201 },
  );
}
