import "server-only";
import { requireJournalOwner } from "./auth";
import { fail } from "./route";
import { daySlug } from "./schemas/day";
import { getUser } from "../../users";
import type { NextResponse } from "next/server";

/**
 * Shared gate for the three reshape doors (B1903) — move, split and merge,
 * under `.../days/{slug}/{move,split,merge}`.
 *
 * Owner-only, like B1904's grant door: same reasoning — a cross-trip move
 * touches two trips at once, and there is no narrower trip-scoped token that
 * safely answers "may this caller move a day OUT of trip A and INTO trip B".
 * A trip-scoped (buddy) token is refused here rather than only checked
 * against one side of the operation.
 *
 * Validates the URL's own `{slug}` against the exact pattern
 * `dayWrite`/the day route's own PUT already use (`daySlug`, day.ts) — a
 * day's slug is also a filename, so this is a security boundary as much as
 * a shape check, same reasoning `daySlug`'s own doc comment gives. The
 * transactional functions in `lib/studio/reshapeDay.ts` re-validate every
 * trip id and date themselves (B1892) — this gate does not replace that,
 * only refuses an obviously-wrong slug before bothering to call them.
 */
export async function gateReshape(
  request: Request,
  user: string,
  slug: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return { ok: false, response: auth.response };
  if (!getUser(user)) return { ok: false, response: fail("no_such_journal", `No journal called "${user}".`, undefined, 404) };
  if (!daySlug.test(slug)) {
    return { ok: false, response: fail("invalid_request", `"${slug}" is not YYYY-MM-DD-slug.`, undefined, 400) };
  }
  return { ok: true };
}

/** `2026-01-11-da-lat` → `da-lat` — the bare slug every
 * `lib/studio/reshapeDay.ts` function actually addresses a day by (see that
 * module's own header on the two conventions). */
export function bareSlugOf(stem: string): string {
  return stem.replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

const RESHAPE_STATUS: Record<string, number> = {
  unknown_trip: 404,
  unknown_day: 404,
};

/** Every reshape error maps to 409 (a real conflict on disk) except the two
 * "there was nothing there to act on" cases, which are 404 — the same split
 * `.../days/{slug}` itself already draws. `invalid_request` is the one
 * exception to that default, always 400, matching every other v2 route. */
export function reshapeFail(code: string, message: string, details?: unknown): NextResponse {
  const status = code === "invalid_request" ? 400 : (RESHAPE_STATUS[code] ?? 409);
  return fail(code as Parameters<typeof fail>[0], message, details, status);
}
