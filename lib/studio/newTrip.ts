import "server-only";
import { getTrips } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { journalCurrencies } from "@/lib/rates";
import { isEnabled } from "@/lib/capabilities";
import { listContacts } from "@/lib/contacts";
import { getFigureDoc, listFiguresPage, DEFAULT_FIGURES_LIMIT } from "@/lib/figures";
import type { FigureDoc } from "@/lib/api/v2/schemas/figures";

/**
 * "A new trip" — B1821, spec §7.2.
 *
 * The one server read this flow needs before it ever asks anything: the
 * existing trips, with the dates and the status `lib/trips.ts` already
 * derived for them. Nothing else about the flow reads the filesystem — the
 * create itself goes through `POST /api/helper/[user]/trip`, the same route
 * `create_trip` already writes through (B685), so a trip made from this page
 * is a trip made any other way.
 *
 * `existingTrips` exists for exactly one thing: T3!, the overlapping-dates
 * notice. `NewTripFlow` already knows the trip it is about to create (the
 * title and the two dates it just gathered), so once the create call returns
 * it can ask, client-side, whether any trip in this list is *also*
 * `status: "current"` — the same status `loadTrips()` (`lib/trips.ts`) has
 * already resolved down to at most one, resolving the tie in favour of the
 * later `start`. This is a notice about *today*, not a control, so nothing
 * here is written back — see `NewTripFlow.tsx`'s own doc comment.
 */
export type ExistingTripSummary = { id: string; title: string; start: string; end: string; status: string };

export function existingTripsForNewTrip(username: string): ExistingTripSummary[] {
  return getTrips(username).map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end, status: t.status }));
}

/** Enough of a contact for the "name them now" picker — never the postal
 * address, the digest opt-ins or anything else the studio's people page
 * already owns. */
export type NewTripContact = { name: string; email: string };

/** A figure for the "choose" picker — the whole `FigureDoc`, not just its id:
 * the client draws each one through the same preview route an agent already
 * confirms a figure with (`GET /api/v2/{user}/figures/preview?figure=…`), so
 * "choose" shows a picture rather than a name a person cannot judge. */
export type NewTripFigure = FigureDoc;

export type NewTripRest = {
  /** The journal's other languages — never including `defaultLocale` — so
   * the step's "Other languages" question is only shown when this is
   * non-empty (B2021, spec: "only when the journal keeps more than one
   * locale"). */
  otherLocales: string[];
  defaultLocale: string;
  baseCurrency: string;
  /** `journalCurrencies` — base first; the only codes the flow offers (B2143). */
  currencies: string[];
  /** Empty when `contacts` is off — the picker then reads as "nobody yet"
   * rather than failing. */
  contacts: NewTripContact[];
  /** This journal's whole figure library, for the "choose" answer. */
  figures: NewTripFigure[];
  /** The journal's own default party — `UserConfig.figures` (`lib/config.ts`)
   * names only ids; resolved here into the same drawable docs `figures`
   * above carries, for "See the journal's set" (B2021, review point 6) to
   * preview what "the journal's own" actually draws. Empty when the journal
   * has none configured. */
  journalFigures: NewTripFigure[];
};

/**
 * "The rest" — B2021, step 3 of 4. Everything the new step's own questions
 * need to read before they can be asked, gathered here the same way
 * `existingTripsForNewTrip` gathers T3!'s own read: server-side, once, so
 * the client component only ever renders what it is handed.
 */
export async function restForNewTrip(username: string): Promise<NewTripRest> {
  const journal = getUser(username);
  const contacts = isEnabled("contacts", username)
    ? (await listContacts(username))
        .filter((c) => c.name)
        .map((c) => ({ name: c.name as string, email: c.email }))
    : [];
  const figures = listFiguresPage(username, { limit: DEFAULT_FIGURES_LIMIT }).items;
  const journalFigures =
    journal?.figures?.mode === "set"
      ? journal.figures.figures.map((id) => getFigureDoc(username, id)).filter((f): f is FigureDoc => f !== null)
      : [];
  return {
    otherLocales: journal ? journal.locales.filter((l) => l !== journal.defaultLocale) : [],
    defaultLocale: journal?.defaultLocale ?? "en",
    baseCurrency: journal?.baseCurrency ?? "CHF",
    currencies: journalCurrencies(username),
    contacts,
    figures,
    journalFigures,
  };
}
