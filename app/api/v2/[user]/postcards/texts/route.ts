// GET /api/v2/{user}/postcards/texts?trip= — B1624, phase 2 step 4.
// Prefill material for a card's message — every day's opening line, in every
// locale the journal writes in. Unchanged from v1 in substance.
import { isTestContent } from "@/lib/access";
import { isEnabled } from "@/lib/capabilities";
import { fail, ok } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { defaultLocaleFor, localesFor } from "@/lib/locales";
import { openingOf } from "@/lib/postcard/opening";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/postcards/texts">,
) {
  const { user } = await params;
  if (!getUser(user) || !isEnabled("postcards") || !isEnabled("contacts")) {
    return fail("postcards_disabled", ERROR_CODES.postcards_disabled, undefined, 404);
  }
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const tripId = new URL(request.url).searchParams.get("trip")?.trim() ?? "";
  const ref = tripRef(user, tripId);
  const trip = tripId ? getTrip(ref) : undefined;
  if (!trip) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const written = defaultLocaleFor(user);
  const offered = localesFor(user);

  const days = getAllEntries(ref, AS_AUTHOR)
    .filter((entry) => !isTestContent(trip, entry))
    .map((entry) => {
      const texts: Record<string, string> = {};
      for (const locale of offered) {
        const source = locale === written ? entry.content : entry.translations?.[locale]?.content;
        const opening = openingOf(source ?? "");
        if (opening) texts[locale] = opening;
      }
      return { slug: entry.slug, date: entry.date, title: entry.title, texts };
    })
    .filter((day) => Object.keys(day.texts).length > 0);

  return ok({ trip: ref, writtenLocale: written, locales: offered, days });
}
