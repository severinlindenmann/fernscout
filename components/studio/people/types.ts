/** Shared shapes for `PeopleFlow` — B1823, spec §7.4. */

/** One row, whichever door it came through. A row with no email is kept and
 *  shown (never silently dropped), but only a row that carries one can ever
 *  be selected — `lib/contacts` keys every contact on its address. */
export type PersonRow = {
  name: string;
  email?: string;
  tel?: string;
  source: "vcard" | "typed";
};
