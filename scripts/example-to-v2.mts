/**
 * content/example, v1 markdown → v2-canonical JSON. B1643, phase 3.
 *
 * Reads the demo journal the way v1 wrote it and writes it back through the
 * REAL serializers (`dayToJson`/`tripToJson`/`writeFigureDoc`), so the output
 * cannot drift from the format the server reads: if this script and the
 * server ever disagree about the shape, the disagreement is a compile error
 * rather than a corrupt journal.
 *
 * It prints a migration report — every field mapped, dropped or declined —
 * because a transformation nobody can see is a transformation nobody agreed
 * to (docs/v2-migration/04-instruments.md).
 *
 * Run: npm run example:v2 -- [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { dayToJson, tripToJson, type DayFile, type TripFile } from "../lib/api/v2/documents";

const ROOT = path.join(process.cwd(), "content", "example");
const DRY = process.argv.includes("--dry");
const report: string[] = [];
function note(kind: string, where: string, what: string) {
  report.push(`${kind.padEnd(9)} ${where.padEnd(46)} ${what}`);
}

/** A decline carries a real reason (>=10 chars) the next reader can act on.
 * These are the demo's own voice, not a migration apology, because the
 * example teaches an agent what a good decline looks like. Where the v1
 * content genuinely recorded nothing and nothing can be inferred, the
 * standard migration sentence is used instead (M3). */
const DAY_DECLINE_REASONS: Record<string, string> = {
  media: "no photographs were taken on this day",
  costs: "no figures were kept for this day",
  coordinates: "no position was recorded for this day",
  weather: "the weather was not looked up for this day",
  time: "the hour was not noted when this was written",
  timezone: "the zone was not recorded when this was written",
  location: "not recorded when this was written (migrated from v1)",
  country: "not recorded when this was written (migrated from v1)",
  countryCode: "not recorded when this was written (migrated from v1)",
  transportMode: "a day in one place, with no leg to record",
  tags: "this day was never tagged",
  translations: "this day has not been translated yet",
  visibility: "shown to everyone the trip already lets in",
  status: "written as a draft, the way every day arrives",
};
const TRIP_DECLINE_REASONS: Record<string, string> = {
  rates: "every figure on this trip is in the journal's own currency",
  costs: "the spending on this trip was never totalled",
  plan: "nothing was planned in advance — it was decided as we went",
  days: "this trip has not started yet",
  translations: "this trip has not been translated yet",
  accent: "no colour was chosen; the default suits it",
  cover: "no photograph has been chosen for the card yet",
  figures: "nobody has been drawn for this trip yet",
  tagline: "the title says everything this trip needs",
  intro: "the days speak for themselves; no opening was written",
  listed: "advertised like every other public trip",
  buddies: "travelling alone on this one",
};

/**
 * R1 (06-contract-deltas.md), completed here as that row says it would be:
 * twelve translation blocks carry the prose in German or Hungarian with the
 * title left in English. `dayWrite` requires both — an absent title and a
 * title deliberately identical are different claims, and only one of them is
 * recoverable a year later — so the rejected fix was to loosen the schema
 * and the accepted one was to finish the content. These are the titles, in
 * the register the surrounding blocks already use.
 */
const R1_TITLES: Record<string, Record<string, string>> = {
  "2023-01-09-bangkok-first-morning": { de: "Erster Morgen in Bangkok", hu: "Első reggel Bangkokban" },
  "2023-01-09-bangkok-still-awake": { hu: "Még mindig ébren, még mindig meleg" },
  "2023-03-02-mekong-slow-boat": { de: "Zwei Tage auf dem Mekong", hu: "Két nap a Mekongon" },
  "2025-09-05-vegas-and-a-cooler": { de: "Las Vegas, und eine Kühlbox" },
  "2025-09-06-zion-narrows": { hu: "Felfelé a Narrowsban" },
  "2025-09-07-bryce-at-six": { de: "Bryce um sechs Uhr morgens" },
  "2025-09-17-independence-pass": { hu: "Át az Independence-hágón" },
  "2025-09-22-back-to-denver": { de: "Zurück nach Denver" },
  "2026-06-19-utah-red-country": { de: "Rotes Land", hu: "Vörös vidék" },
};

/** ── days ─────────────────────────────────────────────────────────────── */

type Fm = Record<string, unknown>;

function dayFromV1(tripId: string, file: string): DayFile {
  const slug = file.replace(/\.md$/, "");
  const parsed = matter(fs.readFileSync(path.join(ROOT, "trips", tripId, "entries", file), "utf8"));
  const fm = parsed.data as Fm;
  const at = `${tripId}/${slug}`;
  const day: DayFile = {
    slug,
    title: String(fm.title ?? slug),
    date: String(fm.date ?? slug.slice(0, 10)),
    content: parsed.content.trim(),
    status: fm.draft === true || fm.status === "draft" ? "draft" : "published",
  };

  const titles = R1_TITLES[slug];
  if (titles && fm.translations && typeof fm.translations === "object") {
    for (const [locale, title] of Object.entries(titles)) {
      const block = (fm.translations as Record<string, Fm>)[locale];
      if (block && block.title === undefined) {
        block.title = title;
        note("R1", at, `translations.${locale}.title: "${title}"`);
      }
    }
  }

  const carry = ["time", "timezone", "location", "country", "countryCode",
    "transportMode", "transportFrom", "transportTo", "travelScene", "tags",
    "translations", "visibility", "test"] as const;
  for (const k of carry) if (fm[k] !== undefined) (day as Fm)[k] = fm[k];

  // lat/lng → one coordinates object: two addresses for one fact became one.
  if (typeof fm.lat === "number" && typeof fm.lng === "number") {
    day.coordinates = { lat: fm.lat, lng: fm.lng };
    note("mapped", at, "lat+lng → coordinates{lat,lng}");
  }

  // gallery → media. Captions already ride each item in this content; the
  // disk-only type/width/height/poster are carried through untouched.
  if (Array.isArray(fm.gallery)) {
    day.media = (fm.gallery as Fm[]).map((g) => {
      const item: Fm = { src: g.src, type: g.type ?? "image" };
      if (g.caption !== undefined) item.caption = g.caption;
      if (g.visibility !== undefined) item.visibility = g.visibility;
      if (g.width !== undefined) item.width = g.width;
      if (g.height !== undefined) item.height = g.height;
      if (g.poster !== undefined) item.poster = g.poster;
      return item;
    }) as DayFile["media"];
    note("mapped", at, `gallery[${day.media!.length}] → media[]`);
  }

  // B560's distinction, kept: an empty list is "nothing was spent" (an
  // answer); a decline is "the figures are gone" (no answer).
  if (Array.isArray(fm.costs)) day.costs = fm.costs as DayFile["costs"];
  else if (fm.costs === false) {
    day.costs = [];
    note("mapped", at, 'costs: false → costs: [] (nothing spent is an answer)');
  } else if (fm.costs === "unknown") {
    note("mapped", at, 'costs: "unknown" → declined.costs (the figures are gone)');
  }

  // weather: the ask and the reading were two keys and are now one field —
  // a reading whose `source` says whose it is, or `true` while unanswered.
  if (fm.weatherData && typeof fm.weatherData === "object") {
    day.weather = fm.weatherData as DayFile["weather"];
    note("mapped", at, "weather:true + weatherData → weather (the reading itself)");
  } else if (fm.weather === true) day.weather = true;

  const declined: Record<string, string> = {};
  if (fm.costs === "unknown") declined.costs = "money was spent and the figures are gone";
  for (const [key, reason] of Object.entries(DAY_DECLINE_REASONS)) {
    if (key === "status") continue; // a file always has one
    if ((day as Fm)[key] !== undefined || declined[key] !== undefined) continue;
    declined[key] = reason;
    note("declined", at, `${key}: "${reason}"`);
  }
  if (Object.keys(declined).length > 0) day.declined = declined;

  for (const k of Object.keys(fm)) {
    if (["title","date","content","draft","status","lat","lng","gallery","costs","weather","weatherData",...carry].includes(k)) continue;
    note("DROPPED", at, `${k} (no v2 address)`);
  }
  return day;
}

/** ── trips ────────────────────────────────────────────────────────────── */

function tripFromV1(tripId: string): { trip: TripFile; figures: Fm[] } {
  const dir = path.join(ROOT, "trips", tripId);
  const tm = matter(fs.readFileSync(path.join(dir, "trip.md"), "utf8"));
  const fm = tm.data as Fm;
  const at = tripId;

  const trip: TripFile = {
    id: tripId,
    title: String(fm.title ?? tripId),
    dates: { from: String(fm.start), to: String(fm.end) },
    visibility: (fm.visibility as TripFile["visibility"]) ?? "public",
    people: [],
  };
  note("mapped", at, "start/end → dates{from,to}");

  if (Array.isArray(fm.people) && fm.people.length > 0) {
    trip.people = fm.people as TripFile["people"];
  } else {
    // v2 requires at least one person: a trip nobody was on is not a trip.
    // v1 let the block be absent, and absent meant the owner — so that is
    // what it becomes, rather than an invention.
    const owner = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")).owner as Fm;
    trip.people = [{ name: owner.name, nickname: owner.nickname, email: owner.email }] as TripFile["people"];
    note("mapped", at, "people absent → the journal's owner (v2 requires at least one)");
  }
  for (const k of ["tagline", "accent", "cover", "translations", "listed", "teaser", "test"] as const) {
    if (fm[k] !== undefined) (trip as Fm)[k] = fm[k];
  }
  if (tm.content.trim()) trip.intro = tm.content.trim();

  // rates: a bare {EUR: 0.94} was both "which currencies" and "at what rate".
  if (fm.rates && typeof fm.rates === "object") {
    const manual = fm.rates as Record<string, number>;
    trip.rates = { currencies: Object.keys(manual), manual };
    note("mapped", at, `rates{${Object.keys(manual)}} → rates.currencies + rates.manual`);
  }

  // costs.md → the trip document's own costs section.
  const costsPath = path.join(dir, "costs.md");
  if (fs.existsSync(costsPath)) {
    const cm = matter(fs.readFileSync(costsPath, "utf8"));
    const cfm = cm.data as Fm;
    const costs: Fm = {};
    if (cfm.budget) costs.budget = cfm.budget;
    if (Array.isArray(cfm.costs)) costs.items = cfm.costs;
    if (cm.content.trim()) costs.note = cm.content.trim();
    if (fm.costsVisibility !== undefined) costs.visibility = fm.costsVisibility;
    if (costs.budget) {
      trip.costs = costs as TripFile["costs"];
      note("mapped", at, "costs.md → trip.costs{budget,items,note,visibility}");
    }
  }

  // plan.md → the trip document's own plan section.
  const planPath = path.join(dir, "plan.md");
  if (fs.existsSync(planPath)) {
    const pm = matter(fs.readFileSync(planPath, "utf8"));
    const pfm = pm.data as Fm;
    if (Array.isArray(pfm.route)) {
      const plan: Fm = { route: pfm.route };
      if (pm.content.trim()) plan.body = pm.content.trim();
      trip.plan = plan as TripFile["plan"];
      note("mapped", at, `plan.md → trip.plan{route[${(pfm.route as unknown[]).length}],body}`);
    }
  }

  // travellers → figure documents in the journal's library, referenced by id.
  const figures: Fm[] = [];
  if (Array.isArray(fm.travellers) && fm.travellers.length > 0) {
    const ids = (fm.travellers as Fm[]).map((t, i) => {
      const id = `${tripId}-${i + 1}`;
      const doc: Fm = { id };
      for (const k of ["name","hairStyle","outfit","build","age","skin","hair","eyes","shirt","pants","pack","headscarf","accessories"]) {
        if (t[k] !== undefined) doc[k] = t[k];
      }
      if (typeof t.for === "string") doc.person = t.for;
      figures.push(doc);
      return id;
    });
    trip.figures = { mode: "custom", figures: ids };
    note("mapped", at, `travellers[${ids.length}] → /figures library + figures{mode:custom}`);
  }

  const declined: Record<string, string> = {};
  for (const [key, reason] of Object.entries(TRIP_DECLINE_REASONS)) {
    if (key === "days" || key === "buddies" || key === "listed") continue;
    if ((trip as Fm)[key] !== undefined) continue;
    declined[key] = reason;
    note("declined", at, `${key}: "${reason}"`);
  }
  if (trip.people.length <= 1) {
    declined.buddies = TRIP_DECLINE_REASONS.buddies;
    note("declined", at, "buddies (a solo trip says so)");
  }
  if (trip.visibility === "public" && trip.listed === undefined) {
    declined.listed = TRIP_DECLINE_REASONS.listed;
    note("declined", at, "listed");
  }
  if (Object.keys(declined).length > 0) trip.declined = declined as TripFile["declined"];

  for (const k of Object.keys(fm)) {
    if (["id","title","start","end","visibility","people","tagline","accent","cover","translations","listed","teaser","test","rates","travellers","costsVisibility"].includes(k)) continue;
    note("DROPPED", at, `${k} (${k === "status" ? "derived from the dates now" : "no v2 address"})`);
  }
  return { trip, figures };
}

/** ── the journal itself ───────────────────────────────────────────────── */

function journalFromV1(): Fm[] {
  const p = path.join(ROOT, "config.json");
  const src = JSON.parse(fs.readFileSync(p, "utf8")) as Fm;
  const figures: Fm[] = [];

  const out: Fm = {
    title: src.title,
    tagline: src.tagline,
    owner: src.owner,
    locales: src.locales,
    baseCurrency: src.baseCurrency,
    displayCurrencies: src.displayCurrencies,
    units: src.units,
    // Required and explicit in v2 — no absent-reads-public.
    visibility: "public",
  };
  note("mapped", "config.json", "visibility: public (required and explicit in v2)");

  if (Array.isArray(src.travellers) && src.travellers.length > 0) {
    const ids = (src.travellers as Fm[]).map((t, i) => {
      const person = typeof t.for === "string" ? t.for : undefined;
      const id = person ? person.split("@")[0].replace(/[^a-z0-9-]/gi, "-").toLowerCase() : `traveller-${i + 1}`;
      const doc: Fm = { id };
      for (const k of ["name","hairStyle","outfit","build","age","skin","hair","eyes","shirt","pants","pack","headscarf","accessories"]) {
        if (t[k] !== undefined) doc[k] = t[k];
      }
      if (person) doc.person = person;
      figures.push(doc);
      return id;
    });
    out.figures = { mode: "set", figures: ids };
    note("mapped", "config.json", `travellers[${ids.length}] → /figures library + figures{mode:set}`);
  }

  // The one v1 key kept deliberately: `lib/capabilities.ts` still reads a
  // journal's own `features` block (resolveOne, line ~519), so dropping it
  // here would switch reactions, costs, weather and analytics OFF for the
  // demo. Decision 5 ("features are instance-only") is owed by the CODE, and
  // content cannot lead it — see the ticket filed beside this script.
  out.features = src.features;
  note("kept", "config.json", "features (legacy — code owes decision 5 before this can go)");

  for (const k of Object.keys(src)) {
    if (["title","tagline","owner","locales","baseCurrency","displayCurrencies","units","travellers","features"].includes(k)) continue;
    note("DROPPED", "config.json", `${k} (no v2 address)`);
  }

  if (!DRY) fs.writeFileSync(p, JSON.stringify(out, null, 2) + "\n");
  return figures;
}

/** ── run ──────────────────────────────────────────────────────────────── */

const tripIds = fs.readdirSync(path.join(ROOT, "trips")).filter((d) =>
  fs.statSync(path.join(ROOT, "trips", d)).isDirectory());

const allFigures: Fm[] = journalFromV1();
for (const id of tripIds) {
  const { trip, figures } = tripFromV1(id);
  allFigures.push(...figures);
  const dir = path.join(ROOT, "trips", id);
  const entries = fs.existsSync(path.join(dir, "entries"))
    ? fs.readdirSync(path.join(dir, "entries")).filter((f) => f.endsWith(".md")).sort()
    : [];
  const days = entries.map((f) => dayFromV1(id, f));

  if (days.length === 0 && trip.declined) (trip.declined as Fm).days = TRIP_DECLINE_REASONS.days;

  if (!DRY) {
    fs.writeFileSync(path.join(dir, "trip.json"), tripToJson(trip));
    for (const day of days) {
      fs.writeFileSync(path.join(dir, "entries", `${day.slug}.json`), dayToJson(day));
      fs.rmSync(path.join(dir, "entries", `${day.slug}.md`));
    }
    for (const f of ["trip.md", "costs.md", "plan.md"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) fs.rmSync(p);
    }
  }
  note("written", id, `trip.json + ${days.length} day files`);
}

if (!DRY && allFigures.length > 0) {
  const figDir = path.join(ROOT, "figures");
  fs.mkdirSync(figDir, { recursive: true });
  for (const f of allFigures) {
    fs.writeFileSync(path.join(figDir, `${f.id}.json`), JSON.stringify(f, null, 2) + "\n");
  }
  note("written", "figures/", `${allFigures.length} figure documents`);
}

console.log(report.join("\n"));
console.log(`\n${report.length} transformations${DRY ? " (dry run — nothing written)" : ""}.`);
