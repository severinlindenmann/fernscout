/**
 * Every word the book prints that the trip did not write.
 *
 * Headings, labels, the colophon, the names of the ways of travelling. Not the
 * day's prose, the trip's title or a photograph's caption — those are the
 * author's and are printed as written, in whatever language they were written
 * in.
 *
 * ## Why these are not in `lib/i18n.ts`
 *
 * Two reasons, and the first is the load-bearing one. `lib/i18n.ts` is read
 * through `lib/locales.ts`, which is `server-only`; `lib/photobook/plan.ts` is
 * deliberately pure — no filesystem, no PDF, no server — so that the whole
 * layout can be unit-tested without a byte of anything. Importing the site's
 * translator into the planner would end that, and the planner is better for it.
 *
 * The second is that these are a different vocabulary. The site's ~700 keys are
 * the chrome of a website; these forty are the furniture of a printed book, and
 * a book says "Was es gekostet hat" where a page might say "Kosten". Keeping
 * them apart means neither has to compromise for the other.
 *
 * `test/photobook-strings.test.ts` holds the three languages to the same keys,
 * which is what `test/locales.test.ts` does for the site's own files.
 *
 * ## The one rule for translating these
 *
 * A book is read after the fact, so the verbs are past tense: "Drove", not
 * "Driving". German and Hungarian follow the same rule rather than being
 * translated word for word from the English.
 */

export type BookLocale = "en" | "de" | "hu";

export type BookStrings = {
  /** The heading over the trip's own introduction. */
  intro: string;
  chapter: string;
  volume: string;
  continued: string;

  followers: string;
  followersOne: string;
  followersMany: string;

  transport: string;
  transportNote: string;

  costs: string;
  costsTotal: string;
  costsBefore: string;
  costsOnRoad: string;
  costsPerDay: string;
  costsBudgeted: string;
  costsSpent: string;
  costsWhere: string;
  costsBudgetVsActual: string;
  costsByCountry: string;
  nights: string;

  colophon: string;
  colophonBy: string;
  colophonByNobody: string;
  colophonPublished: string;
  colophonMade: string;

  /** Per mode: the verb for a day's own line, then the counted noun. */
  modeVerb: Record<string, string>;
  modeOne: Record<string, string>;
  modeMany: Record<string, string>;
  /** For a mode this table has never heard of — a journal may invent one. */
  modeOtherOne: string;
  modeOtherMany: string;
};

const EN: BookStrings = {
  intro: "The idea",
  chapter: "Chapter {index} of {of}",
  volume: "Volume {index} of {of}",
  continued: "(continued on the website)",

  followers: "Who came along",
  followersOne: "One person followed this journey from home.",
  followersMany: "{count} people followed this journey from home.",

  transport: "How we got about",
  transportNote: "{count} legs written down, from {from} to {to}.",

  costs: "What it cost",
  costsTotal: "total, everything included",
  costsBefore: "Before we left",
  costsOnRoad: "On the road",
  costsPerDay: "Per day on the road",
  costsBudgeted: "Budgeted",
  costsSpent: "Spent",
  costsWhere: "Where it went",
  costsBudgetVsActual: "Budget and what happened",
  costsByCountry: "By country",
  nights: "nights",

  colophon: "Colophon",
  colophonBy: "Written and photographed by {names}.",
  colophonByNobody: "Written and photographed by the travellers.",
  colophonPublished: "Originally published at {url}",
  colophonMade: "Laid out by Fernscout and printed on demand. Made {date}.",

  modeVerb: {
    flight: "Flew",
    train: "Took the train",
    bus: "Took the bus",
    car: "Drove",
    motorbike: "Rode",
    boat: "Sailed",
    walk: "Walked",
  },
  modeOne: {
    flight: "flight",
    train: "day by train",
    bus: "day by bus",
    car: "day driving",
    motorbike: "day on the bike",
    boat: "day on the water",
    walk: "day walking",
  },
  modeMany: {
    flight: "flights",
    train: "days by train",
    bus: "days by bus",
    car: "days driving",
    motorbike: "days on the bike",
    boat: "days on the water",
    walk: "days walking",
  },
  modeOtherOne: "day by {mode}",
  modeOtherMany: "days by {mode}",
};

const DE: BookStrings = {
  intro: "Die Idee",
  chapter: "Kapitel {index} von {of}",
  volume: "Band {index} von {of}",
  continued: "(weiter auf der Website)",

  followers: "Wer mitgereist ist",
  followersOne: "Eine Person hat diese Reise von zu Hause aus verfolgt.",
  followersMany: "{count} Menschen haben diese Reise von zu Hause aus verfolgt.",

  transport: "Wie wir unterwegs waren",
  transportNote: "{count} Etappen notiert, von {from} bis {to}.",

  costs: "Was es gekostet hat",
  costsTotal: "insgesamt, alles zusammen",
  costsBefore: "Vor der Abreise",
  costsOnRoad: "Unterwegs",
  costsPerDay: "Pro Tag unterwegs",
  costsBudgeted: "Budgetiert",
  costsSpent: "Ausgegeben",
  costsWhere: "Wofür es draufging",
  costsBudgetVsActual: "Budget und was daraus wurde",
  costsByCountry: "Nach Land",
  nights: "Nächte",

  colophon: "Impressum",
  colophonBy: "Geschrieben und fotografiert von {names}.",
  colophonByNobody: "Geschrieben und fotografiert von den Reisenden.",
  colophonPublished: "Ursprünglich veröffentlicht auf {url}",
  colophonMade: "Von Fernscout gesetzt und auf Bestellung gedruckt. Erstellt am {date}.",

  modeVerb: {
    flight: "Geflogen",
    train: "Mit dem Zug",
    bus: "Mit dem Bus",
    car: "Gefahren",
    motorbike: "Mit dem Motorrad",
    boat: "Mit dem Boot",
    walk: "Zu Fuss",
  },
  modeOne: {
    flight: "Flug",
    train: "Tag im Zug",
    bus: "Tag im Bus",
    car: "Tag am Steuer",
    motorbike: "Tag auf dem Motorrad",
    boat: "Tag auf dem Wasser",
    walk: "Tag zu Fuss",
  },
  modeMany: {
    flight: "Flüge",
    train: "Tage im Zug",
    bus: "Tage im Bus",
    car: "Tage am Steuer",
    motorbike: "Tage auf dem Motorrad",
    boat: "Tage auf dem Wasser",
    walk: "Tage zu Fuss",
  },
  modeOtherOne: "Tag mit {mode}",
  modeOtherMany: "Tage mit {mode}",
};

const HU: BookStrings = {
  intro: "Az ötlet",
  chapter: "{index}. fejezet, összesen {of}",
  volume: "{index}. kötet, összesen {of}",
  continued: "(folytatás a weboldalon)",

  followers: "Kik tartottak velünk",
  followersOne: "Egy ember követte ezt az utat otthonról.",
  followersMany: "{count} ember követte ezt az utat otthonról.",

  transport: "Hogyan közlekedtünk",
  transportNote: "{count} szakasz feljegyezve, {from} és {to} között.",

  costs: "Mennyibe került",
  costsTotal: "összesen, mindennel együtt",
  costsBefore: "Indulás előtt",
  costsOnRoad: "Úton",
  costsPerDay: "Naponta úton",
  costsBudgeted: "Tervezett",
  costsSpent: "Elköltött",
  costsWhere: "Mire ment el",
  costsBudgetVsActual: "A terv és ami lett belőle",
  costsByCountry: "Országonként",
  nights: "éjszaka",

  colophon: "Kolofon",
  colophonBy: "Írta és fényképezte: {names}.",
  colophonByNobody: "Írták és fényképezték az utazók.",
  colophonPublished: "Eredetileg itt jelent meg: {url}",
  colophonMade: "A Fernscout tördelte, igény szerint nyomtatva. Készült: {date}.",

  modeVerb: {
    flight: "Repülővel",
    train: "Vonattal",
    bus: "Busszal",
    car: "Autóval",
    motorbike: "Motorral",
    boat: "Hajóval",
    walk: "Gyalog",
  },
  modeOne: {
    flight: "repülőút",
    train: "nap vonaton",
    bus: "nap buszon",
    car: "nap autóban",
    motorbike: "nap motoron",
    boat: "nap a vízen",
    walk: "nap gyalog",
  },
  modeMany: {
    flight: "repülőút",
    train: "nap vonaton",
    bus: "nap buszon",
    car: "nap autóban",
    motorbike: "nap motoron",
    boat: "nap a vízen",
    walk: "nap gyalog",
  },
  modeOtherOne: "nap {mode} eszközzel",
  modeOtherMany: "nap {mode} eszközzel",
};

const TABLES: Record<BookLocale, BookStrings> = { en: EN, de: DE, hu: HU };

export function isBookLocale(value: string): value is BookLocale {
  return value === "en" || value === "de" || value === "hu";
}

/** The book's words in one language, falling back to English for anything a
 * journal asks for that this table does not have. */
export function bookStrings(locale: string): BookStrings {
  return isBookLocale(locale) ? TABLES[locale] : EN;
}

/** `"{count} people"` + `{ count: "18" }` → `"18 people"`. The same `{name}`
 * convention the site's own translator uses, so a translator moving between
 * the two files is not learning a second syntax. */
export function fill(template: string, vars: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) => vars[key] ?? whole);
}
