import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { listContacts } from "@/lib/contacts";
import { MAX_FIGURES_LIMIT, figureTripRows, listFiguresPage } from "@/lib/figures";
import { currentHelperProvider, hasHelperConsent, helperConsent } from "@/lib/helper/consent";
import { journalV2Fields } from "@/lib/journals";
import type { FigureDoc } from "@/lib/api/v2/schemas/figures";
import { getUser } from "@/lib/users";

/**
 * Everything "Who's on this trip?" needs from the journal (B-2847), read
 * once on the server like the figure library page does: the owner, the
 * contacts to suggest, the figures that exist, the journal's own walking
 * set and whether the photo door is on. Nothing here sends a mail or reads
 * a grant; a contact is only a name and an address to copy onto the trip.
 */
export type TripPeopleSheetData = {
  owner: { name: string; email?: string; nickname?: string };
  contacts: { name: string; email: string }[];
  figures: FigureDoc[];
  journalSet: string[];
  photoConsent: boolean;
  /** Present when the assistant is on but photos were never agreed to for
   *  today's provider: the sheet may ask in place (B-2906). `declined` is an
   *  explicit earlier no, which is only linked to, never asked again. */
  photoAsk?: { provider: string; declined: boolean };
};

export async function tripPeopleSheetData(username: string): Promise<TripPeopleSheetData> {
  const journal = getUser(username);
  const owner = journal?.owner;
  const journalFields = journal ? journalV2Fields(journal) : undefined;
  const helperOn = isEnabled("helper", username);
  const photoConsent = helperOn && hasHelperConsent(username, "photos");
  return {
    owner: {
      name: owner?.nickname || owner?.name || username,
      ...(owner?.email ? { email: owner.email.trim().toLowerCase() } : {}),
      ...(owner?.nickname ? { nickname: owner.nickname } : {}),
    },
    contacts: isEnabled("contacts", username)
      ? (await listContacts(username)).map((c) => ({ name: c.name ?? c.email, email: c.email }))
      : [],
    figures: listFiguresPage(username, { limit: MAX_FIGURES_LIMIT }).items,
    journalSet: journalFields?.figures?.mode === "set" ? journalFields.figures.figures : [],
    photoConsent,
    ...(helperOn && !photoConsent
      ? { photoAsk: { provider: currentHelperProvider("photos"), declined: !!helperConsent(username)?.declined?.includes("photos") } }
      : {}),
  };
}

/** The people on one trip as the sheet lists them, minus the owner (who is
 *  always first and is added by the sheet), and the trip's figure set as ids. */
export function tripPeopleSheetTrip(
  username: string,
  tripId: string,
  people: { name: string; email?: string }[],
  ownerEmail: string | undefined,
  journalSet: string[],
): { people: { name: string; email?: string }[]; figureSet: string[] } {
  const owner = getUser(username)?.owner;
  const ownerNames = [owner?.name, owner?.nickname].filter((n): n is string => !!n);
  const row = figureTripRows(username).find((r) => r.id === tripId);
  const figureSet = !row || row.answer === "off" || row.answer === "declined" ? [] : row.answer === "custom" ? row.figures : journalSet;
  return {
    people: (people ?? [])
      .filter((p) => !(ownerEmail && p.email === ownerEmail))
      .filter((p) => ownerEmail || p.email || !ownerNames.includes(p.name)).map((p) => ({ name: p.name, ...(p.email ? { email: p.email } : {}) })),
    figureSet,
  };
}
