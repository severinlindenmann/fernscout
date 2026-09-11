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
  /** Which table this is — `lib/photobook/text.ts` uses it to pick date
   * order and punctuation, since that varies by language too. */
  locale: BookLocale;
  /** The twelve month names, in this language's own case: capitalised for
   * English and German, lower case for Hungarian. */
  months: readonly string[];

  /** The heading over the trip's own introduction. */
  intro: string;
  chapter: string;
  volume: string;
  continued: string;
  /** A day's own heading, run on to a second page — B517. `{title}` is the
   * day's title, printed as written; only the suffix is this file's. */
  continuedTitle: string;

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

  /** The optional chart pages — B565. Off unless somebody asks for them. */
  chartsSpend: string;
  chartsCumulative: string;
  chartsDaily: string;
  chartsAverage: string;
  chartsBudgetLine: string;
  chartsWeather: string;
  chartsHighLow: string;
  chartsRain: string;
  chartsAvgHigh: string;
  chartsAvgLow: string;
  /** "{count} days had no reading." Never a guess at what they were. */
  chartsMissing: string;
  chartsSource: string;

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
  locale: "en",
  months: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],

  intro: "The idea",
  chapter: "Chapter {index} of {of}",
  volume: "Volume {index} of {of}",
  continued: "(continued on the website)",
  continuedTitle: "{title} — continued",

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

  chartsSpend: "Where the money went",
  chartsCumulative: "Spent, day by day",
  chartsDaily: "What each day cost",
  chartsAverage: "average",
  chartsBudgetLine: "the budget",
  chartsWeather: "The weather we had",
  chartsHighLow: "Daily high and low",
  chartsRain: "Rain",
  chartsAvgHigh: "average high",
  chartsAvgLow: "average low",
  chartsMissing: "{count} days have no reading, and are left blank.",
  chartsSource: "Measured by {source}.",

  colophon: "Colophon",
  colophonBy: "Written and photographed by {names}.",
  colophonByNobody: "Written and photographed by the travellers.",
  colophonPublished: "Originally published at {url}",
  colophonMade: "Laid out by Fernscout and printed on demand. Made {date}.",

  modeVerb: {
    flight: "Flew",
    train: "Took the train",
    metro: "Took the metro",
    tram: "Took the tram",
    bus: "Took the bus",
    car: "Drove",
    taxi: "Took a taxi",
    motorbike: "Rode",
    bicycle: "Cycled",
    boat: "Sailed",
    ferry: "Took the ferry",
    walk: "Walked",
  },
  modeOne: {
    flight: "flight",
    train: "day by train",
    metro: "day by metro",
    tram: "day by tram",
    bus: "day by bus",
    car: "day driving",
    taxi: "day by taxi",
    motorbike: "day on the bike",
    bicycle: "day on the bicycle",
    boat: "day on the water",
    ferry: "day by ferry",
    walk: "day walking",
  },
  modeMany: {
    flight: "flights",
    train: "days by train",
    metro: "days by metro",
    tram: "days by tram",
    bus: "days by bus",
    car: "days driving",
    taxi: "days by taxi",
    motorbike: "days on the bike",
    bicycle: "days on the bicycle",
    boat: "days on the water",
    ferry: "days by ferry",
    walk: "days walking",
  },
  modeOtherOne: "day by {mode}",
  modeOtherMany: "days by {mode}",
};

const DE: BookStrings = {
  locale: "de",
  months: [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ],

  intro: "Die Idee",
  chapter: "Kapitel {index} von {of}",
  volume: "Band {index} von {of}",
  continued: "(weiter auf der Website)",
  continuedTitle: "{title} — Fortsetzung",

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

  chartsSpend: "Wofür das Geld draufging",
  chartsCumulative: "Ausgegeben, Tag für Tag",
  chartsDaily: "Was jeder Tag gekostet hat",
  chartsAverage: "Durchschnitt",
  chartsBudgetLine: "das Budget",
  chartsWeather: "Das Wetter, das wir hatten",
  chartsHighLow: "Höchst- und Tiefstwerte",
  chartsRain: "Niederschlag",
  chartsAvgHigh: "im Mittel höchstens",
  chartsAvgLow: "im Mittel mindestens",
  chartsMissing: "Für {count} Tage gibt es keine Messung; sie bleiben leer.",
  chartsSource: "Gemessen von {source}.",

  colophon: "Impressum",
  colophonBy: "Geschrieben und fotografiert von {names}.",
  colophonByNobody: "Geschrieben und fotografiert von den Reisenden.",
  colophonPublished: "Ursprünglich veröffentlicht auf {url}",
  colophonMade: "Von Fernscout gesetzt und auf Bestellung gedruckt. Erstellt am {date}.",

  modeVerb: {
    flight: "Geflogen",
    train: "Mit dem Zug",
    metro: "Mit der Metro",
    tram: "Mit dem Tram",
    bus: "Mit dem Bus",
    car: "Gefahren",
    taxi: "Mit dem Taxi",
    motorbike: "Mit dem Motorrad",
    bicycle: "Mit dem Velo",
    boat: "Mit dem Boot",
    ferry: "Mit der Fähre",
    walk: "Zu Fuss",
  },
  modeOne: {
    flight: "Flug",
    train: "Tag im Zug",
    metro: "Tag in der Metro",
    tram: "Tag im Tram",
    bus: "Tag im Bus",
    car: "Tag am Steuer",
    taxi: "Tag im Taxi",
    motorbike: "Tag auf dem Motorrad",
    bicycle: "Tag auf dem Velo",
    boat: "Tag auf dem Wasser",
    ferry: "Tag auf der Fähre",
    walk: "Tag zu Fuss",
  },
  modeMany: {
    flight: "Flüge",
    train: "Tage im Zug",
    metro: "Tage in der Metro",
    tram: "Tage im Tram",
    bus: "Tage im Bus",
    car: "Tage am Steuer",
    taxi: "Tage im Taxi",
    motorbike: "Tage auf dem Motorrad",
    bicycle: "Tage auf dem Velo",
    boat: "Tage auf dem Wasser",
    ferry: "Tage auf der Fähre",
    walk: "Tage zu Fuss",
  },
  modeOtherOne: "Tag mit {mode}",
  modeOtherMany: "Tage mit {mode}",
};

const HU: BookStrings = {
  locale: "hu",
  // Hungarian month names are lower case, unlike German's.
  months: [
    "január", "február", "március", "április", "május", "június",
    "július", "augusztus", "szeptember", "október", "november", "december",
  ],

  intro: "Az ötlet",
  chapter: "{index}. fejezet, összesen {of}",
  volume: "{index}. kötet, összesen {of}",
  continued: "(folytatás a weboldalon)",
  continuedTitle: "{title} — folytatás",

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

  chartsSpend: "Mire ment el a pénz",
  chartsCumulative: "Elköltve, napról napra",
  chartsDaily: "Mennyibe került egy-egy nap",
  chartsAverage: "átlag",
  chartsBudgetLine: "a keret",
  chartsWeather: "Milyen időnk volt",
  chartsHighLow: "Napi maximum és minimum",
  chartsRain: "Csapadék",
  chartsAvgHigh: "átlagos maximum",
  chartsAvgLow: "átlagos minimum",
  chartsMissing: "{count} napról nincs mérés, ezek üresen maradnak.",
  chartsSource: "Mérte: {source}.",

  colophon: "Kolofon",
  colophonBy: "Írta és fényképezte: {names}.",
  colophonByNobody: "Írták és fényképezték az utazók.",
  colophonPublished: "Eredetileg itt jelent meg: {url}",
  colophonMade: "A Fernscout tördelte, igény szerint nyomtatva. Készült: {date}.",

  modeVerb: {
    flight: "Repülővel",
    train: "Vonattal",
    metro: "Metróval",
    tram: "Villamossal",
    bus: "Busszal",
    car: "Autóval",
    taxi: "Taxival",
    motorbike: "Motorral",
    bicycle: "Kerékpárral",
    boat: "Hajóval",
    ferry: "Komppal",
    walk: "Gyalog",
  },
  modeOne: {
    flight: "repülőút",
    train: "nap vonaton",
    metro: "nap metrón",
    tram: "nap villamoson",
    bus: "nap buszon",
    car: "nap autóban",
    taxi: "nap taxival",
    motorbike: "nap motoron",
    bicycle: "nap kerékpáron",
    boat: "nap a vízen",
    ferry: "nap a kompon",
    walk: "nap gyalog",
  },
  modeMany: {
    flight: "repülőút",
    train: "nap vonaton",
    metro: "nap metrón",
    tram: "nap villamoson",
    bus: "nap buszon",
    car: "nap autóban",
    taxi: "nap taxival",
    motorbike: "nap motoron",
    bicycle: "nap kerékpáron",
    boat: "nap a vízen",
    ferry: "nap a kompon",
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
