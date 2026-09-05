import { isTestContent } from "@/lib/access";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { getAllEntries } from "@/lib/entries";
import { defaultLocaleFor, localesFor } from "@/lib/locales";
import { openingOf } from "@/lib/postcard/opening";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/<user>/postcards/texts?trip=<id>` — what a card could say, in
 * every language the journal keeps it in — B478.
 *
 * The composer used to prefill from one markdown twin: the day the photograph
 * belongs to, in the language the journal is written in. Both halves of that
 * were wrong for the person writing a card to somebody in Budapest from a
 * week's worth of days, and both were already on disk — `translations:` on an
 * entry carries the same prose per locale, and the trip has all its days.
 *
 * So this answers once with all of it, and the two selects in the sheet are
 * local state after that. A trip of forty days in three languages is about
 * forty kilobytes; a fetch per day and per language would be a hundred and
 * twenty round trips to say the same thing.
 *
 * Owner only, the same guard as `…/postcards/recipients` beside it — this
 * includes drafts, which is a day nobody has decided to publish, and a
 * trip-scoped token has no business reading them from another trip.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/postcards/texts">,
) {
  const { user } = await params;

  if (!getUser(user) || !isEnabled("postcards", user) || !isEnabled("contacts", user)) {
    return Response.json(
      {
        error: "postcards_disabled",
        message:
          "Postcards need both the postcards and the contacts capability, and this journal " +
          "does not have both. /api/health says which are on and why.",
      },
      { status: 404 },
    );
  }
  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message: "Only the address that owns this journal may read its days this way.",
      },
      { status: 403 },
    );
  }

  const tripId = new URL(request.url).searchParams.get("trip")?.trim() ?? "";
  const ref = tripRef(user, tripId);
  const trip = tripId ? getTrip(ref) : undefined;
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const written = defaultLocaleFor(user);
  const offered = localesFor(user);

  // Test content is a day nobody lived, and `POST …/postcards` refuses to
  // order from one — so offering its words would be offering a text that
  // cannot be used.
  const days = getAllEntries(ref, { includeDrafts: true })
    .filter((entry) => !isTestContent(trip, entry))
    .map((entry) => {
      const texts: Record<string, string> = {};
      for (const locale of offered) {
        const source =
          locale === written ? entry.content : entry.translations?.[locale]?.content;
        const opening = openingOf(source ?? "");
        // A locale with no translation is absent rather than falling back to
        // the written one: the select is how somebody says what language the
        // card is in, and quietly handing them German under "Magyar" would
        // make that answer a lie.
        if (opening) texts[locale] = opening;
      }
      return { slug: entry.slug, date: entry.date, title: entry.title, texts };
    })
    .filter((day) => Object.keys(day.texts).length > 0);

  return Response.json({ trip: ref, writtenLocale: written, locales: offered, days });
}
