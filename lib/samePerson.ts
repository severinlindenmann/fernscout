/**
 * Who counts as the same person on a trip's `people:` list (B-2949).
 *
 * Two doors write that list — the studio sheet (a typed name, often with no
 * address yet) and the assistant (a name with an address, from a contact
 * card) — and each only compared what it knew: the sheet by name, the route
 * by address. A name-only "Nicolas" and an emailed "Nicolas" were then two
 * people. One rule, used by both doors and by `peopleBlock`: the same address,
 * or either side has no address and the names are the same.
 *
 * Pure, no server imports: the studio sheet is a client component.
 */
export type ListedPerson = { name: string; email?: string; nickname?: string };

const nameKey = (name: string) => name.trim().toLowerCase();
const emailKey = (email: string | undefined) => (email ?? "").trim().toLowerCase();

export function samePerson(a: ListedPerson, b: ListedPerson): boolean {
  const ea = emailKey(a.email);
  const eb = emailKey(b.email);
  if (ea && eb) return ea === eb;
  return nameKey(a.name) === nameKey(b.name);
}

/**
 * `person` folded into `list`: appended when nobody on it is the same person,
 * otherwise merged into that entry in place — the address wins, a nickname
 * from either side is kept, the listed name stays as it was. Never returns a
 * list with the person twice; returns `list` itself when nothing changes.
 */
export function addPerson<T extends ListedPerson>(list: T[], person: T): T[] {
  const at = list.findIndex((one) => samePerson(one, person));
  if (at < 0) return [...list, person];
  const one = list[at];
  const email = emailKey(one.email) || emailKey(person.email);
  const nickname = one.nickname || person.nickname;
  if (email === emailKey(one.email) && nickname === one.nickname) return list;
  const merged = { ...one, ...(email ? { email } : {}), ...(nickname ? { nickname } : {}) };
  return list.map((x, i) => (i === at ? merged : x));
}

/** The entry on `list` with this name and no address — the one an incoming
 *  address would be attached to. */
export function nameOnlyMatch<T extends ListedPerson>(list: T[], name: string): T | undefined {
  return list.find((one) => !emailKey(one.email) && nameKey(one.name) === nameKey(name));
}
