// Seeds the demo journal: five trips, real photographs, one short clip.
//
//   node scripts/build-demo-content.mjs            # entries only, offline
//   node scripts/build-demo-content.mjs --media    # also fetch photos, make the clip
//   node scripts/build-demo-content.mjs --force    # overwrite an existing content/example
//
// This is the content a fresh clone sees at /example, and it is what the test
// guide walks through. It exists as a script rather than as committed prose so
// the shape of a trip stays regenerable while the project is still moving.
//
// It is also the only place every field is exercised at once, which is the
// point: a field nothing in content/example/ uses is a field nobody notices
// has broken. Between them these five trips cover all three `status` values,
// all five accents, every cost category, several updates in one day, per-trip
// and per-entry translations, tags, covers, a clip with a poster, named
// travellers, planned stops with notes, and future-dated drafts that extend
// the route on the owner's own map.
//
// Photographs come from Lorem Picsum, which serves Unsplash images; every one
// is requested by a fixed seed so a rebuild produces the same journal rather
// than a different one. Each is fetched twice: once at web size into `media/`,
// and once at 4000px into `originals/`, which is what the photobook prints
// from. Same seed, so the two are the same photograph. The video clip is assembled locally with ffmpeg from
// photographs already fetched — no second download, and nothing to license.
//
// **This is a one-off seeder, not the source of truth — B556.** A run against
// a checkout that already has `content/example/` rewrote 42 files with 161
// deletions against 30 insertions: `weatherData:` a real archive lookup
// filled in (B325), `transportMode:`/`transportFrom:`/`transportTo:`, and 22
// lines of `usa-2026/trip.md`, all gone, with `Wrote 5 trips, 38 entries` and
// exit 0 the only trace. The committed journal has drifted ahead of what this
// script knows how to write — see B541, which is the separate, still-open
// question of making the two agree again — so overwriting it silently is a
// straight content loss, not a regeneration. `git diff --stat content/example`
// is the only place that showed it, which is to say: only to somebody who
// happened to run this in a clean checkout and thought to look.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
// B541: a test regenerates into a scratch directory and diffs it against
// content/example rather than overwriting the committed journal, so `--out`
// exists for that — nothing else should need it.
const OUT_ARG = process.argv.find((a) => a.startsWith("--out="));
const USER = OUT_ARG ? path.resolve(OUT_ARG.slice("--out=".length)) : path.join(ROOT, "content", "example");

/**
 * Where the committed journal lives, regardless of where this run is writing.
 *
 * `photos.json` is **source**, not output: it is the list of real photographs
 * a trip has in git, and a `--out=` run into a scratch directory still has to
 * read it or it would regenerate the frontmatter against photographs that are
 * not there. B211.
 */
const SOURCE = path.join(ROOT, "content", "example");
const WITH_MEDIA = process.argv.includes("--media");
const FORCE = process.argv.includes("--force");

/** Landscape, portrait and square, so the gallery and the book have to cope. */
const SHAPES = [
  { w: 1600, h: 1067 },
  { w: 1600, h: 1067 },
  { w: 1067, h: 1600 },
  { w: 1400, h: 1400 },
];

/**
 * The long edge of the kept original, in pixels.
 *
 * `originals/` is what the photobook prints from — `printSourceFor` in
 * `lib/photobook/source.ts` prefers it and falls back to the web copy with a
 * warning. The demo journal had none, so every book built from it printed from
 * a 1600px derivative and warned about all of it: 1067px across a 290mm page
 * is about 93 DPI, which is newspaper. B501.
 *
 * 4000 because the widest page the book prints is the cover's 324mm, which
 * needs 3826px at 300 DPI. Higher only costs download time; lower puts the
 * warnings back.
 *
 * Picsum serves the *same photograph* for a seed at any size, so this changes
 * the demo's resolution and not which pictures it shows.
 */
const ORIGINAL_LONG_EDGE = 4000;

/** The same shape, scaled so its long edge is `ORIGINAL_LONG_EDGE`. */
function originalShape(shape) {
  const scale = ORIGINAL_LONG_EDGE / Math.max(shape.w, shape.h);
  return { w: Math.round(shape.w * scale), h: Math.round(shape.h * scale) };
}

const TRIPS = [
  // ---- short, in the past -------------------------------------------------
  {
    id: "alps-2024",
    title: "Four days round the Alps",
    tagline: "A borrowed estate car, three passes, too much cheese",
    start: "2024-09-12",
    end: "2024-09-15",
    status: "past",
    accent: "green",
    cover: "/media/alps-2024/grimsel-and-rain/01.jpg",
    visibility: "public",
    costsVisibility: "public",
    travellers: [
      {
        skin: "light-medium",
        hair: "brown",
        hairStyle: "short",
        shirt: "rust",
        pants: "slate",
        accessories: ["beanie", "stick"],
      },
    ],
    intro:
      "Four days, one borrowed car, and a loop over three passes. Short enough that we never unpacked properly, long enough that we stopped talking about work.",
    translations: {
      de: {
        title: "Vier Tage rund um die Alpen",
        tagline: "Ein geliehener Kombi, drei Pässe, zu viel Käse",
      },
      hu: {
        title: "Négy nap az Alpok körül",
        tagline: "Egy kölcsönkért kombi, három hágó, túl sok sajt",
      },
    },
    rates: { EUR: 0.94 },
    budget: { total: 900, days: 4, currency: "CHF" },
    preparation: [
      { label: "Vignette and tolls", amount: 90, category: "transport" },
      { label: "Roof box hire", amount: 60, category: "preparation" },
    ],
    costsNote:
      "Four days is short enough that the preparation is most of what you decide in advance. The rest of it happened at petrol stations.",
    planNote:
      "Three passes and whatever was between them. We booked one guesthouse and left the other three nights open.",
    plan: [
      { location: "Susten Pass", country: "Switzerland", code: "CH", lat: 46.7297, lng: 8.4444, note: "Leave after work, sleep somewhere near the top" },
      { location: "Grimsel Pass", country: "Switzerland", code: "CH", lat: 46.5614, lng: 8.3372, note: "The only night we booked" },
      { location: "Domodossola", country: "Italy", code: "IT", lat: 46.1161, lng: 8.2939, note: "Down the Italian side for lunch" },
      { location: "Andermatt", country: "Switzerland", code: "CH", lat: 46.6364, lng: 8.5942, note: "Home over the Furka" },
    ],
    days: [
      {
        date: "2024-09-12",
        slug: "over-the-susten",
        title: "Over the Susten",
        location: "Susten Pass",
        country: "Switzerland",
        code: "CH",
        lat: 46.7297,
        lng: 8.4444,
        transport: null,
        photos: 3,
        // One picture out of three, which is about the honest rate. A caption
        // is what somebody said about a photograph, so most have none.
        captions: ["The last hairpin before the pass"],
        tags: ["alps", "passes", "driving"],
        costs: [
          { label: "Fuel", amount: 78, category: "transport" },
          { label: "Lunch at the pass", amount: 46, category: "food" },
        ],
        text: "We left Zurich late and regretted it for exactly as long as it took to get past Lucerne. The Susten is the kind of road that makes a borrowed estate car feel like a much better car than it is.\n\nAt the top there was a hut selling soup and one flavour of cake. We had both, twice.",
        de: {
          title: "Über den Susten",
          content: "Wir sind spät aus Zürich losgefahren und haben das genau so lange bereut, bis wir Luzern hinter uns hatten. Der Susten ist die Sorte Straße, die einen geliehenen Kombi deutlich besser wirken lässt, als er ist.\n\nOben gab es eine Hütte mit Suppe und genau einer Sorte Kuchen. Wir hatten beides, zweimal.",
        },
        hu: {
          title: "Át a Susten-hágón",
          content: "Későn indultunk Zürichből, és pontosan addig bántuk, amíg magunk mögött nem hagytuk Lucernt. A Susten az a fajta út, amitől egy kölcsönkért kombi sokkal jobb autónak tűnik, mint amilyen.\n\nFent volt egy kunyhó levessel és pontosan egyféle süteménnyel. Mindkettőből kértünk, kétszer.",
        },
      },
      {
        date: "2024-09-13",
        slug: "grimsel-and-rain",
        title: "Grimsel, in the rain",
        location: "Grimsel Pass",
        country: "Switzerland",
        code: "CH",
        lat: 46.5614,
        lng: 8.3372,
        transport: { mode: "car", from: "Susten Pass", to: "Grimsel Pass" },
        photos: 4,
        tags: ["alps", "passes", "rain"],
        // The one demo day that records its own weather rather than asking for
        // a lookup — B325, and it is here rather than anywhere else because
        // this is the day where the two answers genuinely differ.
        //
        // The archive's reanalysis grid says snow at −4°C for this coordinate
        // on this date; the people who were at the guesthouse wrote down rain.
        // Both can be true — a grid cell covering a 2000-metre pass is not the
        // porch of the building they were standing on — and deciding which to
        // print is exactly what the hand-supplied path is for. It also shows
        // the visible difference: an archive reading is credited with a link,
        // a person's own is credited in their own words.
        weather: false,
        weatherData:
          'weatherData: { tempMin: 2, tempMax: 6, code: 63, precipitation: 11, ' +
          'source: "the guesthouse thermometer", recordedAt: "2024-09-13T18:30:00Z" }',
        costs: [
          { label: "Guesthouse", amount: 145, category: "accommodation" },
          { label: "Dinner", amount: 62, category: "food" },
        ],
        text: "Rain the whole way up and cloud so low the reservoir looked like the edge of the world. We had the viewpoint entirely to ourselves, which is one way to sell bad weather.\n\nThe guesthouse had one other guest, a cyclist who had ridden up in it on purpose.",
      },
      {
        date: "2024-09-14",
        // The shortest trip has a two-update day too — four days is not too
        // few for the pager to have to draw a branch.
        time: "12:10",
        slug: "into-italy",
        title: "A wrong turn into Italy",
        location: "Domodossola",
        country: "Italy",
        code: "IT",
        lat: 46.1161,
        lng: 8.2939,
        transport: { mode: "car", from: "Grimsel Pass", to: "Domodossola" },
        photos: 3,
        tags: ["italy", "markets", "driving"],
        costs: [
          { label: "Coffee and pastries", amount: 11, category: "food", currency: "EUR" },
          { label: "Groceries", amount: 34, category: "food", currency: "EUR" },
        ],
        text: "Not really a wrong turn — we just kept going down the wrong side of the mountain and found ourselves buying coffee in euros. Nobody minded.\n\nA market was packing up in the square. We bought tomatoes we had nowhere to cook and ate them like apples in the car park.",
      },
      {
        date: "2024-09-14",
        time: "21:30",
        slug: "we-stayed-for-dinner",
        title: "We stayed for dinner",
        location: "Domodossola",
        country: "Italy",
        code: "IT",
        lat: 46.1161,
        lng: 8.2939,
        tags: ["italy", "food", "unplanned"],
        costs: [
          { label: "Room above the restaurant", amount: 85, category: "accommodation", currency: "EUR" },
          { label: "Dinner, all four things", amount: 48, category: "food", currency: "EUR" },
        ],
        text: "Decided in the car park not to drive back over the pass tonight. There was a room above the restaurant and the restaurant had a menu with four things on it.\n\nWe ate all four between the two of us and went to bed in Italy, which was not the plan we left with.",
        de: {
          title: "Wir sind zum Abendessen geblieben",
          content: "Auf dem Parkplatz entschieden, heute nicht mehr über den Pass zurückzufahren. Über dem Restaurant gab es ein Zimmer, und auf der Karte standen vier Gerichte.\n\nWir haben zu zweit alle vier gegessen und sind in Italien ins Bett gegangen, was so nicht geplant war.",
        },
      },
      {
        date: "2024-09-15",
        slug: "the-long-way-home",
        title: "The long way home",
        location: "Andermatt",
        country: "Switzerland",
        code: "CH",
        lat: 46.6364,
        lng: 8.5942,
        transport: { mode: "car", from: "Domodossola", to: "Andermatt" },
        photos: 2,
        tags: ["alps", "passes", "driving"],
        costs: [{ label: "Fuel", amount: 71, category: "transport" }],
        text: "Home by the Furka because the map said it was nine minutes slower and everybody knows the map is lying about which nine minutes matter.",
      },
    ],
  },

  // ---- long, in the past --------------------------------------------------
  {
    id: "asia-2023",
    title: "Five months east",
    tagline: "Thailand to Vietnam, mostly by train and never in a hurry",
    start: "2023-01-08",
    end: "2023-06-02",
    status: "past",
    accent: "coral",
    cover: "/media/asia-2023/mekong-slow-boat/01.jpg",
    // Two people, so the trip is credited to both — and either of them may
    // hold a token scoped to this trip and nothing else. See lib/tripPeople.ts.
    people: [
      { name: "Alex Berger", email: "agent@fernscout.ch", nickname: "Alex" },
      { name: "Priya Fenwick", email: "priya@example.com", nickname: "Priya" },
    ],
    visibility: "public",
    costsVisibility: "public",
    travellers: [
      { skin: "light-medium", hair: "brown", hairStyle: "short", shirt: "sky", pants: "slate", accessories: ["glasses"] },
      { skin: "medium-deep", hair: "black", hairStyle: "braids", shirt: "coral", outfit: "skirt", pants: "plum" },
      { skin: "light", hair: "blond", hairStyle: "bun", shirt: "teal", pants: "slate", pack: "none", accessories: ["camera"] },
      { skin: "deep", hair: "black", hairStyle: "coils", shirt: "yellow", outfit: "dress", pack: "none", accessories: ["sunglasses"] },
      { skin: "medium", hair: "black", hairStyle: "headscarf", headscarf: "cream", shirt: "sand", outfit: "robe", pack: "none" },
    ],
    intro:
      "Five months from Bangkok to Hanoi, overland the whole way. We had a rough plan for the first fortnight and made the rest up on station platforms.",
    translations: {
      de: {
        title: "Fünf Monate im Osten",
        tagline: "Thailand bis Vietnam, meist mit dem Zug und nie in Eile",
      },
      hu: {
        title: "Öt hónap keleten",
        tagline: "Thaiföldtől Vietnamig, jórészt vonattal és soha nem sietve",
      },
    },
    rates: { THB: 0.0258, VND: 0.0000372, EUR: 0.98 },
    budget: { total: 18000, days: 146, currency: "CHF" },
    preparation: [
      { label: "Flights to Bangkok", amount: 1120, category: "flights" },
      { label: "Travel insurance, six months", amount: 480, category: "other" },
      { label: "Visas, two people", amount: 210, category: "other" },
      { label: "Rucksacks", amount: 390, category: "preparation" },
    ],
    costsNote:
      "Five months of it, and the flight is still the single biggest line. Everything after this was decided a week at a time.",
    planNote:
      "Bangkok to Hanoi overland. This is the version we drew on a napkin in December; the trip mostly agreed with it, which surprised us both.",
    days: [
      // ------------------------------------------------------------------
      // Fixture days — B736. Written by hand for travel-scene vehicle
      // coverage and folded back into the generator here, so that
      // `content/example/` is regenerable rather than partly regenerable.
      // Every one carries `test: true`: nobody lived them, the page says so
      // in a banner, and they are kept out of the feed, the search index and
      // the sitemap. AGENTS.md's one exception, used the way it is meant to
      // be.
      // ------------------------------------------------------------------
      {
        date: "2023-01-08",
        time: "21:40",
        slug: "leaving-zurich",
        title: "Leaving Zurich",
        location: "Zurich",
        country: "Switzerland",
        code: "CH",
        lat: 47.3769,
        lng: 8.5417,
        tags: ["switzerland", "flights"],
        test: true,
        text: "The trip's first leg, and the only one that leaves the ground. Written to show\nwhat a flight looks like on the map: a long dashed arc between two continents,\nagainst the solid train line and the dotted boat further east.\n\nNobody took this day. It exists so the map has an aeroplane on it.",
      },
      {
        date: "2023-01-09",
        // Three updates on one day — the arrival day, written as it went.
        // Two was the most the demo had, and two is the case where "several"
        // and "the one after the first" happen to look the same.
        time: "09:15",
        slug: "bangkok-first-morning",
        title: "First morning in Bangkok",
        location: "Bangkok",
        country: "Thailand",
        code: "TH",
        lat: 13.7563,
        lng: 100.5018,
        transport: { mode: "flight", from: "Zurich", to: "Bangkok" },
        photos: 4,
        captions: [undefined, "The camera, put down for five minutes"],
        tags: ["thailand", "cities", "food"],
        costs: [
          { label: "Street noodles", amount: 120, category: "food", currency: "THB" },
          { label: "Guesthouse", amount: 900, category: "accommodation", currency: "THB" },
        ],
        text: "Landed at six, asleep by eight, awake at three in the morning entirely convinced it was lunchtime. By the time it actually was lunchtime we had been walking for four hours and eaten twice.\n\nThe heat is not the thing people warn you about. The thing is the noise, and how quickly you stop hearing it.",
        de: "Um sechs gelandet, um acht geschlafen, um drei Uhr nachts hellwach und fest überzeugt, es sei Mittag. Als es dann wirklich Mittag war, waren wir vier Stunden gelaufen und hatten zweimal gegessen.\n\nDie Hitze ist nicht das, wovor die Leute warnen. Es ist der Lärm — und wie schnell man ihn nicht mehr hört.",
        hu: "Hatkor landoltunk, nyolckor aludtunk, hajnali háromkor pedig teljesen éberen, abban a hitben, hogy dél van. Mire tényleg dél lett, négy órát gyalogoltunk és kétszer ettünk.\n\nNem a hőség az, amire figyelmeztetnek. Hanem a zaj — és hogy milyen gyorsan nem hallod meg többé.",
      },
      {
        date: "2023-01-09",
        time: "16:40",
        slug: "bangkok-boat-to-thonburi",
        title: "Across the river on the wrong boat",
        location: "Bangkok",
        country: "Thailand",
        code: "TH",
        lat: 13.7563,
        lng: 100.5018,
        // The gallery sits on an update that is not the day's lead — which is
        // the arrangement that used to quietly drop photographs from a day.
        photos: 3,
        tags: ["thailand", "boats", "rivers"],
        costs: [
          { label: "River boat, the expensive one", amount: 160, category: "transport", currency: "THB" },
        ],
        text: "Meant to take the orange-flag ferry two stops and took the blue-flag one instead, which is for tourists and costs four times as much. We worked it out when the commentary started.\n\nGot off in Thonburi anyway and walked back over the bridge. Every photograph is of the wrong side of the river and better for it.",
        de: {
          title: "Mit dem falschen Boot über den Fluss",
          content: "Wir wollten zwei Stationen mit der orangen Fähre fahren und sind in die blaue gestiegen, die für Touristen ist und viermal so viel kostet. Gemerkt haben wir es, als die Ansage anfing.\n\nSind trotzdem in Thonburi ausgestiegen und über die Brücke zurückgelaufen. Jedes Foto zeigt die falsche Flussseite und ist dadurch besser.",
        },
      },
      {
        date: "2023-01-09",
        time: "22:50",
        slug: "bangkok-still-awake",
        title: "Still awake, still hot",
        location: "Bangkok",
        country: "Thailand",
        code: "TH",
        lat: 13.7563,
        lng: 100.5018,
        tags: ["thailand", "food", "nights"],
        costs: [
          { label: "Second dinner, standing up", amount: 95, category: "food", currency: "THB" },
        ],
        text: "The street outside the guesthouse does its best trade at eleven at night, and we have stopped pretending we are going to sleep through it.\n\nSecond dinner, eaten standing up. No photographs: the phone was flat by nine and neither of us went back for the charger.",
        hu: "A vendégház előtti utca este tizenegykor megy a legjobban, és feladtuk, hogy majd átalusszuk.\n\nMásodik vacsora, állva megevett. Fotó nincs: a telefon kilencre lemerült, és egyikünk sem ment vissza a töltőért.",
      },
      {
        date: "2023-01-24",
        slug: "night-train-north",
        title: "The night train north",
        location: "Chiang Mai",
        country: "Thailand",
        code: "TH",
        lat: 18.7883,
        lng: 98.9853,
        transport: { mode: "train", from: "Bangkok", to: "Chiang Mai" },
        // Thirteen hours in one line: the scene plays, briefly.
        travelScene: "quick",
        photos: 3,
        tags: ["thailand", "trains", "sleeper"],
        costs: [
          { label: "Sleeper berth", amount: 881, category: "transport", currency: "THB" },
          { label: "Breakfast on board", amount: 90, category: "food", currency: "THB" },
        ],
        text: "Thirteen hours, a bunk with a curtain, and a man with a trolley who appeared every ninety minutes whether or not anybody wanted anything.\n\nWoke somewhere past Lampang with the window full of green and no idea what time it was. Best sleep of the trip so far.",
      },
      {
        date: "2023-02-10",
        slug: "chiang-rai-by-car",
        title: "Hired a car as far as Chiang Rai",
        location: "Chiang Rai",
        country: "Thailand",
        code: "TH",
        lat: 19.9105,
        lng: 99.8406,
        weather: false,
        transport: { mode: "car", from: "Chiang Mai", to: "Chiang Rai" },
        tags: ["thailand", "roads"],
        test: true,
        text: "A fixture day: the road leg the scene needs to draw tarmac, a centre line and a car with its wheels turning.\n\nThree hours of highway, which is the shortest thing in this trip and the fastest thing on this page.",
      },
      {
        date: "2023-02-20",
        slug: "the-slow-bus-to-the-border",
        title: "The slow bus to the border",
        location: "Huay Xai",
        country: "Laos",
        code: "LA",
        lat: 20.2806,
        lng: 100.4128,
        weather: false,
        transport: { mode: "bus", from: "Chiang Rai", to: "Huay Xai" },
        tags: ["laos", "borders", "buses"],
        test: true,
        text: "A fixture day, and the one that puts the trip on the right bank for the boat two weeks later.\n\nThe bus is the same road as the car and a different vehicle on it — which is the whole thing this day is here to show.",
      },
      {
        date: "2023-03-02",
        slug: "mekong-slow-boat",
        title: "Two days on the Mekong",
        location: "Luang Prabang",
        country: "Laos",
        code: "LA",
        lat: 19.8867,
        lng: 102.1350,
        transport: { mode: "boat", from: "Huay Xai", to: "Luang Prabang" },
        photos: 4,
        video: { caption: "Ten seconds of the bank going past" },
        tags: ["laos", "boats", "slow-travel"],
        costs: [
          { label: "Slow boat, two days", amount: 78, category: "transport" },
          { label: "Night in Pakbeng", amount: 22, category: "accommodation" },
        ],
        text: "Two days on a wooden boat with a car engine bolted into the back of it. There is nothing to do, which is the entire point and takes about four hours to understand.\n\nWe filmed ten seconds of the bank going past on the second afternoon. It is the only video either of us took the whole trip and it is somehow the thing we show people first.",
        de: "Zwei Tage auf einem Holzboot mit einem hinten eingebauten Automotor. Es gibt nichts zu tun, was der ganze Sinn der Sache ist und ungefähr vier Stunden dauert, bis man es versteht.\n\nAm zweiten Nachmittag haben wir zehn Sekunden Ufer gefilmt. Es ist das einzige Video der ganzen Reise — und trotzdem das Erste, was wir den Leuten zeigen.",
        hu: "Két nap egy fahajón, aminek a hátuljába autómotort építettek. Nincs semmi tennivaló, ami az egésznek a lényege, és körülbelül négy órába telik megérteni.\n\nA második délutánon felvettünk tíz másodpercnyi partot. Ez az egyetlen videó az egész útról — és mégis ez az első, amit megmutatunk.",
      },
      {
        date: "2023-03-05",
        slug: "up-the-hill-on-foot",
        title: "Up the hill on foot",
        location: "Phousi",
        country: "Laos",
        code: "LA",
        lat: 19.8895,
        lng: 102.1355,
        weather: false,
        transport: { mode: "walk", from: "Luang Prabang", to: "Phousi" },
        tags: ["laos", "walking"],
        test: true,
        text: "A fixture day for the one leg that has no vehicle at all. On foot the party *is* what crosses the screen — there is nothing else to draw, and the path goes past underneath them.\n\nThree hundred steps, and the shortest leg in the journal.",
      },
      {
        date: "2023-04-18",
        slug: "hue-to-hoi-an",
        title: "Over the Hai Van Pass",
        location: "Hoi An",
        country: "Vietnam",
        code: "VN",
        lat: 15.8801,
        lng: 108.338,
        transport: { mode: "motorbike", from: "Hue", to: "Hoi An" },
        // The one day that opts out of the animation altogether.
        travelScene: "skip",
        photos: 4,
        tags: ["vietnam", "motorbike", "mountains"],
        costs: [
          { label: "Motorbike transfer", amount: 1150000, category: "transport", currency: "VND" },
          { label: "Tailored shirt", amount: 620000, category: "other", currency: "VND" },
        ],
        text: "Rode the pass on the back of somebody else's motorbike with our bags strapped to a third one. It rained at the top and cleared before the bottom, which everyone had told us it would.\n\nHoi An is lit entirely by paper lanterns after dark, and it is exactly as good as that sounds.",
      },
      {
        date: "2023-04-25",
        slug: "over-to-da-nang",
        title: "Over to Da Nang and back",
        location: "Da Nang",
        country: "Vietnam",
        code: "VN",
        lat: 16.0544,
        lng: 108.2022,
        weather: false,
        transport: { mode: "motorbike", from: "Hoi An", to: "Da Nang" },
        tags: ["vietnam", "motorbikes"],
        test: true,
        text: "A fixture day. The motorbike leg earlier in this trip carries `travelScene: skip`, which is exactly what it says — the pager leaves it out entirely — so there was no way to see the rider drawn.\n\nThis is that leg, played.",
      },
      {
        date: "2023-05-30",
        slug: "last-week-hanoi",
        title: "Last week, Hanoi",
        location: "Hanoi",
        country: "Vietnam",
        code: "VN",
        lat: 21.0278,
        lng: 105.8342,
        transport: { mode: "train", from: "Da Nang", to: "Hanoi" },
        photos: 3,
        tags: ["vietnam", "trains", "cities"],
        costs: [
          { label: "Train, soft sleeper", amount: 1290000, category: "transport", currency: "VND" },
          { label: "Coffee, egg, several", amount: 180000, category: "food", currency: "VND" },
        ],
        text: "Five months in and we have become the kind of people who have opinions about which side of a train to sit on.\n\nSpent the last week doing very little on very small chairs. Flew home with more books than we left with and no idea how.",
      },
    ],
  },

  // ---- long, happening now ------------------------------------------------
  {
    id: "usa-2026",
    title: "Across and back",
    tagline: "A pickup, a tent, and most of the western United States",
    start: "2026-06-01",
    end: "2026-11-20",
    status: "current",
    accent: "sky",
    cover: "/media/usa-2026/utah-red-country/01.jpg",
    people: [
      { name: "Alex Berger", email: "agent@fernscout.ch", nickname: "Alex" },
      { name: "Priya Fenwick", email: "priya@example.com", nickname: "Priya" },
    ],
    visibility: "public",
    costsVisibility: "public",
    // `for:` ties a figure to one of `people:` above — the other two on the
    // trip get one each, and the third rider (no `people:` row of their own)
    // is drawn without one, same as any unnamed traveller.
    travellers: [
      { for: "agent@fernscout.ch", skin: "light-medium", hair: "brown", hairStyle: "short", shirt: "sky", accessories: ["glasses"] },
      { for: "priya@example.com", skin: "medium-deep", hair: "black", hairStyle: "braids", shirt: "coral", outfit: "shorts", pants: "sand" },
      { age: "elder", skin: "light", hair: "grey", hairStyle: "short", shirt: "teal", pants: "slate", pack: "none", accessories: ["hat"] },
    ],
    intro:
      "Six months and a second-hand pickup, starting in Denver and going wherever the forest roads do. Still out there — this one is being written as it happens.",
    translations: {
      de: {
        title: "Hin und zurück",
        tagline: "Ein Pick-up, ein Zelt und der halbe Westen der USA",
      },
      hu: {
        title: "Oda és vissza",
        tagline: "Egy pickup, egy sátor és az Egyesült Államok nyugati fele",
      },
    },
    rates: { USD: 0.88 },
    budget: { total: 26000, days: 173, currency: "CHF" },
    preparation: [
      { label: "Flights to Denver", amount: 980, category: "flights" },
      { label: "The truck", amount: 9400, category: "transport" },
      { label: "Tent, stove, the rest of it", amount: 1250, category: "preparation" },
      { label: "Six months of insurance", amount: 640, category: "other" },
    ],
    costsNote:
      "Half of this went before we left the country, and most of that half was the truck. What happens to the other half is the part still being written.",
    planNote:
      "Denver, then west until the ocean and back again. Four fixed points and six months to join them up — the rest is forest roads and whoever we meet on them.",
    // Written by hand rather than derived from the days: this trip is still
    // going, so the plan is a claim about the future and not a summary of the
    // past. It is also the only place a stop gets a `note:`.
    plan: [
      { location: "Denver", country: "United States", code: "US", lat: 39.7392, lng: -104.9903, note: "Buy a truck. Two weeks, at the outside." },
      { location: "Moab", country: "United States", code: "US", lat: 38.5733, lng: -109.5498, note: "First proper test of the tent" },
      { location: "Bishop", country: "United States", code: "US", lat: 37.3614, lng: -118.3951, note: "Sierra, if the fires allow it" },
      { location: "Cannon Beach", country: "United States", code: "US", lat: 45.8918, lng: -123.9615, note: "Reach the Pacific by the end of August" },
      { location: "Missoula", country: "United States", code: "US", lat: 46.8721, lng: -113.9940, note: "East again, before the passes close" },
      { location: "Denver", country: "United States", code: "US", lat: 39.7392, lng: -104.9903, note: "Sell the truck, fly home" },
    ],
    days: [
      // A fixture day's neighbour — B736, and see the note in asia-2023 above.
      // Not `test: true` like the other five: this is a real update of a real
      // day, held back from a public trip, and the demo's only per-update
      // `visibility:` in its narrower form (B596).
      {
        date: "2026-06-03",
        time: "22:10",
        slug: "denver-money",
        title: "The part about the money",
        location: "Denver",
        country: "United States",
        code: "US",
        lat: 39.7392,
        lng: -104.9903,
        weather: false,
        visibility: "private",
        tags: ["colorado", "logistics"],
        de: {
          title: "Der Teil mit dem Geld",
          content:
            "Was der Truck wirklich gekostet hat, aufgeschrieben, solange wir es noch genau wissen — und für uns beide, nicht für den Rest der Welt.",
        },
        text: "What the truck actually cost, written down while we still remember it exactly, and kept to the two of us rather than put on the internet.\n\nNot a secret so much as nobody else's business — which is the whole reason a single update can be held back without the day around it going with it.",
      },
      {
        date: "2026-06-03",
        slug: "denver-and-a-truck",
        title: "Denver, and a truck",
        location: "Denver",
        country: "United States",
        code: "US",
        lat: 39.7392,
        lng: -104.9903,
        photos: 3,
        tags: ["colorado", "logistics"],
        costs: [
          { label: "Motel, two nights", amount: 210, category: "accommodation", currency: "USD" },
          { label: "Registration and plates", amount: 165, category: "other", currency: "USD" },
        ],
        text: "Four days of looking at other people's trucks in other people's driveways. Bought the fifth one we saw, which is either decisive or foolish and we will find out in Utah.\n\nIt has 180,000 miles and a bench seat. The man who sold it to us seemed relieved.",
      },
      {
        date: "2026-06-19",
        slug: "utah-red-country",
        title: "Red country",
        location: "Moab",
        country: "United States",
        code: "US",
        lat: 38.5733,
        lng: -109.5498,
        transport: { mode: "car", from: "Denver", to: "Moab" },
        photos: 4,
        // B596: one photograph out of four held back from a public trip.
        photoVisibility: [undefined, undefined, "guest"],
        tags: ["utah", "desert", "camping"],
        costs: [
          { label: "Fuel", amount: 96, category: "transport", currency: "USD" },
          { label: "Campground, four nights", amount: 80, category: "accommodation", currency: "USD" },
          { label: "Groceries", amount: 143, category: "food", currency: "USD" },
        ],
        text: "The truck made it, loudly. Four nights on a bluff outside town with nobody else on it, which cost twenty dollars a night and felt like theft.\n\nIt is hard to photograph and we tried anyway, several hundred times.",
        hu: "A pickup megcsinálta, hangosan. Négy éjszaka egy dombon a városon kívül, rajtunk kívül senki, húsz dollár egy éjszaka — lopásnak éreztük.\n\nNehéz lefényképezni, és mi mégis megpróbáltuk, több százszor.",
        de: "Der Pick-up hat es geschafft, laut. Vier Nächte auf einem Felsvorsprung außerhalb der Stadt, ganz allein — zwanzig Dollar die Nacht, und es fühlte sich an wie Diebstahl.\n\nEs lässt sich schlecht fotografieren. Wir haben es trotzdem versucht, mehrere hundert Mal.",
      },
      {
        date: "2026-07-28",
        slug: "sierra-smoke",
        title: "Smoke over the Sierra",
        location: "Bishop",
        country: "United States",
        code: "US",
        lat: 37.3614,
        lng: -118.3951,
        transport: { mode: "car", from: "Moab", to: "Bishop" },
        // B596, the coarser half: the whole update held back.
        visibility: "guest",
        photos: 3,
        tags: ["california", "mountains", "wildfire"],
        costs: [
          { label: "Fuel", amount: 121, category: "transport", currency: "USD" },
          { label: "New tyre", amount: 218, category: "transport", currency: "USD" },
        ],
        text: "Fires two valleys over turned the light orange for a week. Beautiful in a way that makes you feel bad about finding it beautiful.\n\nPicked up a nail on a forest road and learned that a tyre shop in a small town will fit you in the same afternoon if you are pleasant about it.",
      },
      {
        date: "2026-08-24",
        // Two updates on one day, which is what `time:` is for and what the
        // day pager calls a branch. The first carries the day's arrival leg;
        // the second is just a note from the evening.
        //
        // The one pair of days that names its zone — B42. `time:` is always
        // the wall clock where the day happened, and until this field existed
        // there was no way to say so, which is how the feed came to stamp a
        // Pacific afternoon as though it were UTC. Cannon Beach is
        // America/Los_Angeles; recording it is what makes the reader's own
        // clock appear beside this one, and it is a fact about the place
        // rather than anything invented about the day.
        timezone: "America/Los_Angeles",
        time: "13:20",
        slug: "oregon-coast",
        title: "Down the Oregon coast",
        location: "Cannon Beach",
        country: "United States",
        code: "US",
        lat: 45.8918,
        lng: -123.9615,
        transport: { mode: "car", from: "Bishop", to: "Cannon Beach" },
        photos: 4,
        captions: ["One leaf still holding the rain", undefined, "The beach at low tide, and one person on the whole of it"],
        photoVisibility: [undefined, undefined, undefined, "private"],
        tags: ["oregon", "coast", "pacific"],
        costs: [
          { label: "Fuel", amount: 88, category: "transport", currency: "USD" },
          { label: "Crab, from a shack", amount: 34, category: "food", currency: "USD" },
        ],
        text: "Cold, grey, and the best week so far. The Pacific here does not look like a holiday; it looks like weather that has come a very long way to arrive.\n\nSlept in the truck twice because the tent was wet and neither of us could face it.",
      },
      {
        date: "2026-08-24",
        time: "21:40",
        slug: "oregon-coast-evening",
        title: "Later, from the same car park",
        // The same zone as the update above it — the two are one day.
        timezone: "America/Los_Angeles",
        location: "Cannon Beach",
        country: "United States",
        code: "US",
        lat: 45.8918,
        lng: -123.9615,
        visibility: "guest",
        tags: ["oregon", "coast"],
        costs: [
          { label: "Laundrette", amount: 9, category: "other", currency: "USD" },
        ],
        text: "Went back down at sunset because somebody in the laundrette said to. They were right, and I have no photographs of it, which is probably the correct outcome.",
        de: {
          title: "Später, vom selben Parkplatz",
          content: "Bin bei Sonnenuntergang nochmal runter, weil jemand im Waschsalon gesagt hat, man solle das. Sie hatten recht, und ich habe keine Fotos davon, was vermutlich das richtige Ergebnis ist.",
        },
      },
    ],
  },
  // ---- many places, one night each, in the past ---------------------------
  //
  // The other three trips all sit still for a while. This one exists to show
  // the opposite shape: eighteen entries, eighteen locations, almost never two
  // nights in the same place — which is what stresses the map, the route line
  // and the day pager rather than the prose.
  {
    id: "parks-2025",
    title: "Eighteen days, eleven parks",
    tagline: "Las Vegas to Denver the long way round, one night at a time",
    start: "2025-09-05",
    end: "2025-09-22",
    status: "past",
    // One accent per trip: sky, green and coral are taken, and two trips
    // sharing a colour makes the lifetime map's legend useless.
    accent: "navy",
    cover: "/media/parks-2025/bryce-at-six/01.jpg",
    visibility: "public",
    costsVisibility: "public",
    travellers: [
      { skin: "light-medium", hair: "brown", hairStyle: "short", shirt: "sky", pants: "slate", accessories: ["cap"] },
      { skin: "medium-deep", hair: "black", hairStyle: "bun", shirt: "green", outfit: "shorts", pants: "sand" },
      { age: "child", skin: "medium", hair: "black", hairStyle: "coils", shirt: "yellow", outfit: "shorts", pants: "slate", pack: "none" },
      { age: "child", skin: "light-medium", hair: "auburn", hairStyle: "curly", shirt: "plum", outfit: "dress", pack: "none" },
    ],
    intro:
      "A rental sedan, a cooler, and a national parks pass that paid for itself by the fourth gate. Las Vegas to Denver by way of Utah, Colorado and the Dakotas — eighteen nights, and never twice in the same bed.",
    translations: {
      de: {
        title: "Achtzehn Tage, elf Parks",
        tagline: "Von Las Vegas nach Denver, auf dem längsten Weg, eine Nacht pro Ort",
      },
      hu: {
        title: "Tizennyolc nap, tizenegy nemzeti park",
        tagline: "Las Vegastól Denverig a hosszabbik úton, éjszakánként új helyen",
      },
    },
    rates: { USD: 0.8 },
    budget: { total: 7200, days: 18, currency: "CHF" },
    preparation: [
      { label: "Flights to Las Vegas", amount: 1120, category: "flights" },
      { label: "Car hire, eighteen days", amount: 940, category: "transport" },
      { label: "Annual parks pass", amount: 72, category: "activities" },
      { label: "Camping gear, borrowed and replaced", amount: 85, category: "preparation" },
    ],
    costsNote:
      "Eighteen nights, and the pass paid for itself by the fourth gate. The two lines that actually decided this trip were both bought before it started.",
    planNote:
      "Booked as a loop because a one-way car hire across four states costs more than the flights. Everything between Las Vegas and Denver was ours to choose.",
    days: [
      {
        date: "2025-09-05",
        slug: "vegas-and-a-cooler",
        title: "Las Vegas, and a cooler",
        location: "Las Vegas",
        country: "United States",
        code: "US",
        lat: 36.1699,
        lng: -115.1398,
        transport: { mode: "flight", from: "Zurich", to: "Las Vegas" },
        photos: 2,
        tags: ["nevada", "logistics"],
        costs: [
          { label: "Motel by the airport", amount: 96, category: "accommodation", currency: "USD" },
          { label: "Cooler, ice, two weeks of coffee", amount: 61, category: "other", currency: "USD" },
        ],
        text: "Landed at four, collected a white sedan that looked like every other white sedan in the lot, and spent an hour in a supermarket the size of an airport buying a cooler.\n\nWe did not go near the Strip. That felt like the right start.",
        de: "Um vier gelandet, eine weiße Limousine abgeholt, die aussah wie jede andere weiße Limousine auf dem Platz, und dann eine Stunde in einem Supermarkt von der Größe eines Flughafens verbracht, um eine Kühlbox zu kaufen.\n\nWir waren nicht in der Nähe des Strip. Das fühlte sich nach dem richtigen Anfang an.",
      },
      {
        date: "2025-09-06",
        slug: "zion-narrows",
        title: "Up the Narrows",
        location: "Zion National Park",
        country: "United States",
        code: "US",
        lat: 37.2982,
        lng: -113.0263,
        transport: { mode: "car", from: "Las Vegas", to: "Springdale" },
        photos: 3,
        captions: [
          "The water going over, and the spray coming straight back up",
          "Steps down into the fog, and nothing at the bottom of them",
        ],
        tags: ["utah", "national-parks", "hiking", "water"],
        costs: [
          { label: "Fuel", amount: 44, category: "transport", currency: "USD" },
          { label: "Cabin in Springdale", amount: 168, category: "accommodation", currency: "USD" },
          { label: "Dry bags and sticks, hired", amount: 52, category: "activities", currency: "USD" },
        ],
        text: "Three hours of walking up a river between walls three hundred metres high, with the water somewhere between knee and waist depending on how well you read the gravel.\n\nEverybody in the canyon was quiet. Not reverent — just concentrating on their feet.",
        hu: "Három óra gyaloglás felfelé egy folyóban, háromszáz méter magas falak között, térd- és derékmagasság közötti vízben — attól függően, mennyire jól olvasod a kavicsot.\n\nA kanyonban mindenki csendben volt. Nem áhítatból — csak a lábukra figyeltek.",
      },
      {
        date: "2025-09-07",
        slug: "bryce-at-six",
        title: "Bryce at six in the morning",
        location: "Bryce Canyon National Park",
        country: "United States",
        code: "US",
        lat: 37.5930,
        lng: -112.1871,
        transport: { mode: "car", from: "Springdale", to: "Bryce Canyon" },
        photos: 3,
        tags: ["utah", "national-parks", "sunrise"],
        costs: [
          { label: "Fuel", amount: 38, category: "transport", currency: "USD" },
          { label: "Campground", amount: 30, category: "accommodation", currency: "USD" },
        ],
        text: "Set an alarm for half past five, which on holiday is a decision you resent in advance and forgive immediately.\n\nThe hoodoos go orange from the top down as the sun arrives, one row at a time. It takes about nine minutes and then it is ordinary daylight again.",
        de: "Wecker auf halb sechs — im Urlaub eine Entscheidung, die man vorher bereut und hinterher sofort verzeiht.\n\nDie Hoodoos werden von oben nach unten orange, wenn die Sonne kommt, Reihe für Reihe. Es dauert etwa neun Minuten, dann ist es wieder ganz normales Tageslicht.",
      },
      {
        date: "2025-09-08",
        slug: "escalante-backroad",
        title: "The long way over Escalante",
        location: "Escalante",
        country: "United States",
        code: "US",
        lat: 37.7700,
        lng: -111.6010,
        transport: { mode: "car", from: "Bryce Canyon", to: "Escalante" },
        photos: 2,
        tags: ["utah", "backroads", "desert"],
        costs: [
          { label: "Fuel", amount: 41, category: "transport", currency: "USD" },
          { label: "Motel", amount: 104, category: "accommodation", currency: "USD" },
          { label: "Diner, twice", amount: 47, category: "food", currency: "USD" },
        ],
        text: "Highway 12 runs along a ridge with a drop on both sides and no barrier on either, which is the most Utah thing that has happened so far.\n\nStopped at a slot canyon that was not on the map we had and was clearly on everybody else's.",
      },
      {
        date: "2025-09-09",
        slug: "capitol-reef-orchard",
        title: "An orchard in the desert",
        location: "Capitol Reef National Park",
        country: "United States",
        code: "US",
        lat: 38.2919,
        lng: -111.2615,
        transport: { mode: "car", from: "Escalante", to: "Torrey" },
        photos: 3,
        tags: ["utah", "national-parks", "food"],
        costs: [
          { label: "Fuel", amount: 36, category: "transport", currency: "USD" },
          { label: "Campground", amount: 25, category: "accommodation", currency: "USD" },
          { label: "Pie, from the orchard", amount: 18, category: "food", currency: "USD" },
        ],
        text: "There is a Mormon orchard in the middle of the park where you can pick fruit off the trees and pay for it by weight in an honesty box.\n\nWe ate four apples each and bought a pie we did not need.",
      },
      {
        date: "2025-09-10",
        slug: "goblin-valley",
        title: "Goblin Valley, briefly",
        location: "Goblin Valley",
        country: "United States",
        code: "US",
        lat: 38.5647,
        lng: -110.7079,
        transport: { mode: "car", from: "Torrey", to: "Green River" },
        photos: 2,
        tags: ["utah", "desert", "camping"],
        costs: [
          { label: "Fuel", amount: 39, category: "transport", currency: "USD" },
          { label: "Motel in Green River", amount: 88, category: "accommodation", currency: "USD" },
        ],
        text: "A valley of small round rock figures that look like a crowd waiting for something. You are allowed to walk anywhere, which after a week of staying on the trail feels almost rude.\n\nForty degrees by eleven, so we left.",
      },
      {
        date: "2025-09-11",
        slug: "arches-at-dusk",
        title: "Arches, once the coaches leave",
        location: "Arches National Park",
        country: "United States",
        code: "US",
        lat: 38.7331,
        lng: -109.5925,
        transport: { mode: "car", from: "Green River", to: "Moab" },
        photos: 3,
        tags: ["utah", "national-parks", "sunset"],
        costs: [
          { label: "Fuel", amount: 34, category: "transport", currency: "USD" },
          { label: "Campground outside Moab", amount: 35, category: "accommodation", currency: "USD" },
          { label: "Groceries", amount: 72, category: "food", currency: "USD" },
        ],
        text: "Went in at six in the evening, which is the trick: the car parks empty, the rock goes the colour it is in the photographs, and the heat drops to something survivable.\n\nDelicate Arch has about eighty people sitting in a semicircle around it, all of them silent, like a small badly attended concert.",
      },
      {
        date: "2025-09-12",
        slug: "needles-district",
        title: "The Needles, and nobody else",
        location: "Canyonlands National Park",
        country: "United States",
        code: "US",
        lat: 38.1653,
        lng: -109.7859,
        transport: { mode: "car", from: "Moab", to: "Needles District" },
        photos: 2,
        tags: ["utah", "national-parks", "hiking"],
        costs: [
          { label: "Fuel", amount: 43, category: "transport", currency: "USD" },
          { label: "Campground", amount: 20, category: "accommodation", currency: "USD" },
        ],
        text: "An hour and a half off the highway to reach the quiet half of Canyonlands. We saw four other cars all day and two of them were rangers.\n\nStars afterwards of the kind that make the sky look crowded rather than empty.",
      },
      {
        date: "2025-09-13",
        // Eighteen places, one night each — and one of those nights still gets
        // two updates. The branch has to work in the trip that moves daily.
        time: "12:30",
        slug: "monument-valley",
        title: "Monument Valley in the wrong light",
        location: "Monument Valley",
        country: "United States",
        code: "US",
        lat: 36.9980,
        lng: -110.0985,
        transport: { mode: "car", from: "Needles District", to: "Monument Valley" },
        photos: 2,
        tags: ["arizona", "desert", "driving"],
        costs: [
          { label: "Fuel", amount: 47, category: "transport", currency: "USD" },
          { label: "Tribal park entry", amount: 20, category: "activities", currency: "USD" },
          { label: "Room on the rim", amount: 195, category: "accommodation", currency: "USD" },
        ],
        text: "Arrived at midday, when the buttes are flat and grey and look like a postcard left in a window. Waited six hours and got the other version.\n\nThis is Navajo land, not a national park, and it is run entirely differently — better signposted about what you may not photograph.",
      },
      {
        date: "2025-09-13",
        time: "21:15",
        slug: "monument-valley-after-dark",
        title: "The six hours were worth it",
        // No costs of its own: the day's spend is all on the lead, which is
        // how a day of several updates usually adds up.
        location: "Monument Valley",
        country: "United States",
        code: "US",
        lat: 36.9980,
        lng: -110.0985,
        tags: ["arizona", "desert", "night"],
        text: "The light came back at about six and the place stopped looking like a postcard and started looking like the reason anybody drives out here at all.\n\nWriting this from a plastic chair outside the room. Nothing photographable in the dark, so this one is only words.",
      },
      {
        date: "2025-09-14",
        slug: "mesa-verde-ladders",
        title: "Ladders at Mesa Verde",
        location: "Mesa Verde National Park",
        country: "United States",
        code: "US",
        lat: 37.2309,
        lng: -108.4618,
        transport: { mode: "car", from: "Monument Valley", to: "Mesa Verde" },
        photos: 3,
        tags: ["colorado", "national-parks", "history"],
        costs: [
          { label: "Fuel", amount: 40, category: "transport", currency: "USD" },
          { label: "Guided cliff dwelling tour", amount: 16, category: "activities", currency: "USD" },
          { label: "Motel in Cortez", amount: 112, category: "accommodation", currency: "USD" },
        ],
        text: "Houses built into the underside of a cliff eight hundred years ago, reached now by a ten-metre wooden ladder that the ranger climbs faster than anybody.\n\nThey lived here for about a century and then left, and the honest answer to why is that nobody is certain.",
      },
      {
        date: "2025-09-15",
        slug: "great-sand-dunes",
        title: "A beach with no sea",
        location: "Great Sand Dunes National Park",
        country: "United States",
        code: "US",
        lat: 37.7916,
        lng: -105.5943,
        transport: { mode: "car", from: "Cortez", to: "Great Sand Dunes" },
        photos: 2,
        tags: ["colorado", "national-parks", "dunes"],
        costs: [
          { label: "Fuel", amount: 52, category: "transport", currency: "USD" },
          { label: "Campground", amount: 28, category: "accommodation", currency: "USD" },
        ],
        text: "Two hundred metres of sand piled against the Sangre de Cristos, with a shallow creek running along the foot of it and children treating the whole thing as a seaside.\n\nWalking up a dune is roughly three steps for every two you keep.",
      },
      {
        date: "2025-09-16",
        slug: "black-canyon",
        title: "Black Canyon, straight down",
        location: "Black Canyon of the Gunnison",
        country: "United States",
        code: "US",
        lat: 38.5754,
        lng: -107.7416,
        transport: { mode: "car", from: "Great Sand Dunes", to: "Montrose" },
        photos: 2,
        tags: ["colorado", "national-parks", "canyons"],
        costs: [
          { label: "Fuel", amount: 45, category: "transport", currency: "USD" },
          { label: "Motel in Montrose", amount: 118, category: "accommodation", currency: "USD" },
        ],
        text: "Narrow enough that parts of the floor get half an hour of direct sun a day, which is why it is called what it is called.\n\nYou stand at a railing and look six hundred metres down at a river you cannot hear.",
      },
      {
        date: "2025-09-17",
        slug: "independence-pass",
        title: "Over Independence Pass",
        location: "Aspen",
        country: "United States",
        code: "US",
        lat: 39.1911,
        lng: -106.8175,
        transport: { mode: "car", from: "Montrose", to: "Aspen" },
        photos: 2,
        tags: ["colorado", "passes", "autumn"],
        costs: [
          { label: "Fuel", amount: 43, category: "transport", currency: "USD" },
          { label: "Room, and it hurt", amount: 265, category: "accommodation", currency: "USD" },
          { label: "Dinner", amount: 94, category: "food", currency: "USD" },
        ],
        text: "Three thousand seven hundred metres, no guardrail, and a road narrow enough that meeting a camper van is a negotiation.\n\nThe aspens had turned that week. Everybody in Colorado seemed to know it and be out in it.",
        hu: "Háromezer-hétszáz méter, korlát nélkül, és az út olyan keskeny, hogy egy lakóautóval találkozni már tárgyalás kérdése.\n\nAzon a héten fordultak sárgába a nyárfák. Coloradóban mindenki tudta, és mindenki kint volt.",
      },
      {
        date: "2025-09-18",
        slug: "trail-ridge-road",
        title: "Trail Ridge Road, above the trees",
        location: "Rocky Mountain National Park",
        country: "United States",
        code: "US",
        lat: 40.3428,
        lng: -105.6836,
        transport: { mode: "car", from: "Aspen", to: "Estes Park" },
        photos: 3,
        tags: ["colorado", "national-parks", "wildlife"],
        costs: [
          { label: "Fuel", amount: 49, category: "transport", currency: "USD" },
          { label: "Cabin in Estes Park", amount: 142, category: "accommodation", currency: "USD" },
        ],
        text: "Eighteen kilometres of road above the tree line, in September, with elk on the verge behaving as though the car were weather.\n\nSnow flurry at the top at two in the afternoon, gone by the time we were down the other side.",
      },
      {
        date: "2025-09-19",
        slug: "wyoming-nothing",
        title: "A long day of nothing, Wyoming",
        location: "Laramie",
        country: "United States",
        code: "US",
        lat: 41.3114,
        lng: -105.5911,
        transport: { mode: "car", from: "Estes Park", to: "Laramie" },
        photos: 2,
        tags: ["wyoming", "driving", "plains"],
        costs: [
          { label: "Fuel", amount: 51, category: "transport", currency: "USD" },
          { label: "Motel", amount: 79, category: "accommodation", currency: "USD" },
        ],
        text: "Four hours in which the only things that changed were the radio stations and the number of freight wagons in the trains running alongside.\n\nThis is the part of a road trip nobody photographs and everybody remembers.",
      },
      {
        date: "2025-09-20",
        slug: "badlands-loop",
        title: "The Badlands, all afternoon",
        location: "Badlands National Park",
        country: "United States",
        code: "US",
        lat: 43.8554,
        lng: -102.3397,
        transport: { mode: "car", from: "Laramie", to: "Badlands" },
        photos: 3,
        tags: ["south-dakota", "national-parks", "wildlife"],
        costs: [
          { label: "Fuel", amount: 58, category: "transport", currency: "USD" },
          { label: "Campground", amount: 22, category: "accommodation", currency: "USD" },
        ],
        text: "Grass, grass, grass, and then the ground simply falls away into striped rock for sixty kilometres.\n\nBighorn sheep on the road at dusk, entirely unbothered. Slept with the tent door open because there was nothing to keep out.",
      },
      {
        date: "2025-09-21",
        slug: "wind-cave",
        title: "Underground at Wind Cave",
        location: "Wind Cave National Park",
        country: "United States",
        code: "US",
        lat: 43.5570,
        lng: -103.4780,
        transport: { mode: "car", from: "Badlands", to: "Custer" },
        photos: 2,
        tags: ["south-dakota", "national-parks", "caves"],
        costs: [
          { label: "Fuel", amount: 33, category: "transport", currency: "USD" },
          { label: "Cave tour", amount: 28, category: "activities", currency: "USD" },
          { label: "Motel in Custer", amount: 96, category: "accommodation", currency: "USD" },
        ],
        text: "The cave breathes: air moves in or out of the entrance depending on the pressure outside, hard enough to feel on your hand.\n\nBison on the prairie above it, in a herd big enough that we sat in the car for twenty minutes waiting for the road back.",
      },
      {
        date: "2025-09-22",
        slug: "back-to-denver",
        title: "Back to Denver",
        location: "Denver",
        country: "United States",
        code: "US",
        lat: 39.7392,
        lng: -104.9903,
        transport: { mode: "car", from: "Custer", to: "Denver" },
        photos: 2,
        tags: ["colorado", "driving"],
        costs: [
          { label: "Fuel", amount: 54, category: "transport", currency: "USD" },
          { label: "Car cleaning, required", amount: 40, category: "transport", currency: "USD" },
          { label: "Last dinner", amount: 76, category: "food", currency: "USD" },
        ],
        text: "Six hours south with the cooler finally empty and about four kilos of red dust in the footwells.\n\nEighteen nights in eighteen different places. We handed the car back with 6,140 kilometres on it and immediately began arguing about which park was best.",
        de: "Sechs Stunden nach Süden, die Kühlbox endlich leer und ungefähr vier Kilo roter Staub in den Fußräumen.\n\nAchtzehn Nächte an achtzehn verschiedenen Orten. Wir haben das Auto mit 6.140 Kilometern zurückgegeben und sofort angefangen zu streiten, welcher Park der beste war.",
      },
    ],
  },

  // ---- planned, hasn't happened yet ---------------------------------------
  //
  // The shape the other four cannot show: a trip with no photographs, no spend
  // and no days, which still has to be a real page. What renders instead is
  // the countdown, the planned route from plan.md, and the budget from
  // costs.md — see components/TripCountdown.tsx.
  //
  // It also carries two future-dated drafts. Those are invisible to a reader,
  // but on the owner's own map they extend the planned route past what plan.md
  // says (W33, lib/plan.ts) — which is the whole argument for letting an agent
  // write ahead of a trip rather than only behind it.
  {
    id: "japan-2027",
    title: "Japan, end to end",
    tagline: "Six weeks on a rail pass, Kyushu to Hokkaido",
    start: "2027-03-28",
    end: "2027-05-09",
    status: "upcoming",
    // The fifth accent. Four trips used four of them and nothing showed what
    // the fifth looked like on the lifetime map.
    accent: "yellow",
    people: [
      { name: "Alex Berger", email: "agent@fernscout.ch", nickname: "Alex" },
      { name: "Priya Fenwick", email: "priya@example.com", nickname: "Priya" },
    ],
    visibility: "public",
    costsVisibility: "public",
    intro:
      "Six weeks from the south end of Kyushu to the north end of Hokkaido, on one rail pass and no car. Nothing has happened yet — this is the plan, the budget, and a countdown.",
    translations: {
      de: {
        title: "Japan, von einem Ende zum anderen",
        tagline: "Sechs Wochen mit dem Bahnpass, von Kyushu nach Hokkaido",
      },
      hu: {
        title: "Japán, az egyik végétől a másikig",
        tagline: "Hat hét vasúti bérlettel, Kjúsútól Hokkaidóig",
      },
    },
    // Frozen from the reference rate the day the budget was written, like
    // every other trip here. It will be wrong by April 2027 and that is fine:
    // what this trip cost is not what a later one will cost.
    rates: { JPY: 0.00504 },
    budget: { total: 14800, days: 43, currency: "CHF" },
    preparation: [
      { label: "Flights to Fukuoka, home from Sapporo", amount: 1240, category: "flights" },
      { label: "Rail pass, 21 days, two people", amount: 1180, category: "preparation" },
      { label: "Boots, one pair, overdue", amount: 260, category: "preparation" },
      // Written in yen on purpose: a preparation cost is not always paid at
      // home, and the trip's own rate is what converts it.
      { label: "IC cards and a data SIM, prepaid", amount: 9000, category: "other", currency: "JPY" },
    ],
    costsNote:
      "Nothing has been spent on the road yet, so this is preparation and a number we have agreed to argue about later. The rail pass is the decision everything else follows from.",
    planNote:
      "South to north, and the rail pass decides most of it. Eight places we mean to sleep in and six weeks to find out what goes between them.",
    plan: [
      { location: "Fukuoka", country: "Japan", code: "JP", lat: 33.5904, lng: 130.4017, note: "Land here, and do nothing for two days" },
      { location: "Nagasaki", country: "Japan", code: "JP", lat: 32.7503, lng: 129.8779, note: "The furthest south we go" },
      { location: "Hiroshima", country: "Japan", code: "JP", lat: 34.3853, lng: 132.4553, note: "Two nights, and the ferry to Miyajima" },
      { location: "Kyoto", country: "Japan", code: "JP", lat: 35.0116, lng: 135.7681, note: "Early April — the one date we are not moving" },
      { location: "Kanazawa", country: "Japan", code: "JP", lat: 36.5613, lng: 136.6562, note: "Across to the west coast, out of the crowds" },
      { location: "Tokyo", country: "Japan", code: "JP", lat: 35.6762, lng: 139.6503, note: "A week, staying put" },
      { location: "Sendai", country: "Japan", code: "JP", lat: 38.2682, lng: 140.8694, note: "North, and the coast road if it is open" },
      { location: "Sapporo", country: "Japan", code: "JP", lat: 43.0618, lng: 141.3545, note: "Fly home from here" },
    ],
    days: [
      // Drafts, both of them: dated inside the trip, written before it, and
      // filtered out of every reading path until a person deletes the line.
      {
        date: "2027-04-14",
        slug: "matsumoto-detour",
        title: "The Matsumoto detour",
        location: "Matsumoto",
        country: "Japan",
        code: "JP",
        lat: 36.2380,
        lng: 137.9720,
        transport: { mode: "train", from: "Kanazawa", to: "Matsumoto" },
        tags: ["japan", "trains", "mountains"],
        draft: true,
        text: "Not on the plan. Priya's colleague says the castle is worth the two changes it takes to get there, and the pass covers it either way.\n\nNothing booked. If it is raining we carry on to Tokyo the same evening.",
      },
      {
        date: "2027-04-30",
        slug: "hakodate-before-sapporo",
        title: "Hakodate, before Sapporo",
        location: "Hakodate",
        country: "Japan",
        code: "JP",
        lat: 41.7688,
        lng: 140.7288,
        transport: { mode: "train", from: "Sendai", to: "Hakodate" },
        tags: ["japan", "trains", "coast"],
        draft: true,
        text: "The tunnel under the strait comes out here, and getting off rather than staying on costs us nothing but a night.\n\nMorning market, then the last leg north.",
      },
    ],
  },
];

// --------------------------------------------------------------------------

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function galleryBlock(trip, day) {
  const items = [];
  // A trip with committed photographs takes its dimensions from the files that
  // are actually there, not from the shape the seeder would have asked Picsum
  // for — otherwise the frontmatter describes a photograph nobody has. B211.
  const committed = committedPhotos(trip)?.[day.slug];
  for (let i = 1; i <= day.photos; i++) {
    const real = committed?.[i - 1];
    const shape = real
      ? { w: real.width, h: real.height }
      : SHAPES[(i - 1) % SHAPES.length];
    // A caption on some photographs and not on others, which is the real
    // shape of a journal — most pictures have nothing said about them, and a
    // demo where every one carries a line would not show that the layout
    // holds either way. `captions` is indexed from the first photo (B522).
    const caption = day.captions?.[i - 1];
    // B596/B736. One photograph held back from a day everyone else can read.
    // `photoVisibility` is indexed like `captions`, from the first photo, and
    // an absent entry is the ordinary case: seen by everyone the trip lets in.
    // The line goes after `caption` because that is where
    // `lib/ingest/entry.ts` puts it — a demo file the product could not have
    // written is a demo file that teaches the wrong shape.
    const shown = day.photoVisibility?.[i - 1];
    items.push(
      `  - src: "/media/${trip.id}/${day.slug}/${String(i).padStart(2, "0")}.jpg"\n` +
        `    type: "image"\n    width: ${shape.w}\n    height: ${shape.h}` +
        (caption ? `\n    caption: ${quote(caption)}` : "") +
        (shown ? `\n    visibility: ${shown}` : ""),
    );
  }
  if (day.video) {
    // `poster:` is the still ffmpeg pulls out of the clip below. Without it
    // the grid draws a video thumbnail by downloading the video, which on a
    // phone is the most expensive image on the page.
    items.push(
      `  - src: "/media/${trip.id}/${day.slug}/clip.mp4"\n` +
        `    type: "video"\n    width: 1280\n    height: 720\n` +
        `    poster: "/media/${trip.id}/${day.slug}/clip.jpg"\n` +
        `    caption: ${quote(day.video.caption)}`,
    );
  }
  return items.join("\n");
}

function writeEntry(trip, day) {
  const lines = [
    "---",
    `title: ${quote(day.title)}`,
    `date: ${quote(day.date)}`,
  ];
  // Only where a day holds more than one update — an entry that is the whole
  // day has no time to be ordered against.
  if (day.time) lines.push(`time: ${quote(day.time)}`);
  // B42 — the IANA zone `time` is a wall clock in, written only where a day
  // names one. Absent, a reader gets the bare time exactly as before.
  if (day.timezone) lines.push(`timezone: ${quote(day.timezone)}`);
  lines.push(
    `location: ${quote(day.location)}`,
    `country: ${quote(day.country)}`,
    `countryCode: ${quote(day.code)}`,
    `lat: ${day.lat}`,
    `lng: ${day.lng}`,
  );
  // B325. `weather: true` is a request, not a value — this script writes no
  // measurement of its own, because it has none and inventing one is the
  // thing the whole feature exists to avoid. `npm run weather:update` fills
  // these in from the archive, and the values it writes are what gets
  // committed here.
  //
  // On by default rather than per-day, because that is what a journal that
  // wants weather actually looks like — somebody turns it on and leaves it
  // on. `weather: false` opts a day out, and the days that use it are the
  // ones whose invented prose already says what the sky was doing: this
  // content was written before there was anything to check it against, and a
  // day captioned "in the rain" beside a measurement saying snow teaches the
  // reader that one of the two is lying.
  //
  // B541: this has to come before `transport` — every committed entry has
  // `weather` first, and a field order the generator disagrees with is a
  // field order it reports as drift on every single day.
  if (day.weather !== false) lines.push("weather: true");
  // B596/B736 — the whole update held back, which is the coarser half of the
  // same field. Before `transportMode`, matching every committed entry that
  // carries one.
  if (day.visibility) lines.push(`visibility: ${day.visibility}`);
  if (day.transport) {
    lines.push(
      `transportMode: ${quote(day.transport.mode)}`,
      `transportFrom: ${quote(day.transport.from)}`,
      `transportTo: ${quote(day.transport.to)}`,
    );
    // B736 — the per-day override on the arrival animation. Only meaningful
    // beside a `transportMode`, since without one there is no leg to play, so
    // it is written inside this block rather than beside it.
    if (day.travelScene) lines.push(`travelScene: ${quote(day.travelScene)}`);
  }
  // The other half of the field: a reading a person took, which is the only
  // kind a caller may supply and must always name its source. Exercised on
  // exactly one demo day so the shape is in the content somewhere.
  if (day.weatherData) lines.push(day.weatherData);
  if (day.photos || day.video) lines.push("gallery:", galleryBlock(trip, day));
  if (day.tags?.length) lines.push(`tags: [${day.tags.map(quote).join(", ")}]`);
  // B736 — a day nobody lived, written to prove something the product draws.
  // AGENTS.md's one exception: the page says so in a banner, and the day is
  // kept out of the feed, the search index and the sitemap. Named here rather
  // than written into the prose, because a convention is not a guarantee.
  if (day.test) lines.push("test: true");
  if (day.costs?.length) {
    lines.push("costs:");
    for (const c of day.costs) {
      const cur = c.currency ? `, currency: ${quote(c.currency)}` : "";
      lines.push(`  - { label: ${quote(c.label)}, amount: ${c.amount}, category: ${quote(c.category)}${cur} }`);
    }
  }
  if (day.de || day.hu) {
    lines.push("translations:");
    for (const code of ["de", "hu"]) {
      // Shorthand: a bare string is prose with no translated title.
      const raw = day[code];
      if (!raw) continue;
      const t = typeof raw === "string" ? { content: raw } : raw;
      lines.push(`  ${code}:`);
      // A translation may carry a title, prose, or both — whatever is missing
      // falls back to what the author wrote (lib/entries.ts).
      if (t.title) lines.push(`    title: ${quote(t.title)}`);
      if (t.content) {
        lines.push(`    content: |`);
        for (const line of t.content.split("\n")) lines.push(`      ${line}`);
      }
    }
  }
  // Last, so it reads as the thing standing between this file and the site.
  // Nothing here removes it; a person does. See AGENTS.md, "The one rule".
  if (day.draft) lines.push("status: draft");
  lines.push("---", "", day.text, "");

  const dir = path.join(USER, "trips", trip.id, "entries");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${day.date}-${day.slug}.md`), lines.join("\n"));
}

function writeTrip(trip) {
  const dir = path.join(USER, "trips", trip.id);
  fs.mkdirSync(dir, { recursive: true });

  const head = [
    "---",
    `id: ${trip.id}`,
    `title: ${quote(trip.title)}`,
    `tagline: ${quote(trip.tagline)}`,
    `start: ${quote(trip.start)}`,
    `end: ${quote(trip.end)}`,
    `status: ${trip.status}`,
    `accent: ${trip.accent}`,
  ];
  // The card photograph, written trip-relative like every other media path —
  // lib/trips.ts puts the owner on the front, so seeding this journal under
  // another name keeps the covers working.
  if (trip.cover) head.push(`cover: ${quote(trip.cover)}`);
  if (trip.people?.length) {
    head.push("people:");
    for (const person of trip.people) {
      head.push(`  - name: ${quote(person.name)}`, `    email: ${quote(person.email)}`);
      if (person.nickname) head.push(`    nickname: ${quote(person.nickname)}`);
    }
  }
  head.push(`visibility: ${trip.visibility}`);
  // Only written when it narrows something: `listed: true` is the default and
  // a line that says what would have happened anyway is a line to keep in step.
  if (trip.listed === false) head.push("listed: false");
  head.push(`costsVisibility: ${trip.costsVisibility}`);
  // Named where somebody is on the trip's own `people:`, unnamed (`for`
  // absent) otherwise — B541. Field order matches `lib/tripWrite.ts`'s
  // `FIGURE_FIELDS`, which is also the order every hand-written figure in
  // this demo already happens to use.
  if (trip.travellers?.length) {
    head.push("travellers:");
    for (const figure of trip.travellers) {
      const lines = [];
      if (figure.for) lines.push(`for: ${quote(figure.for)}`);
      if (figure.age) lines.push(`age: ${figure.age}`);
      lines.push(`skin: ${figure.skin}`, `hair: ${figure.hair}`, `hairStyle: ${figure.hairStyle}`);
      if (figure.headscarf) lines.push(`headscarf: ${figure.headscarf}`);
      lines.push(`shirt: ${figure.shirt}`);
      if (figure.outfit) lines.push(`outfit: ${figure.outfit}`);
      if (figure.pants) lines.push(`pants: ${figure.pants}`);
      if (figure.pack) lines.push(`pack: ${figure.pack}`);
      if (figure.accessories?.length) lines.push(`accessories: [${figure.accessories.join(", ")}]`);
      head.push(`  - ${lines[0]}`);
      for (const line of lines.slice(1)) head.push(`    ${line}`);
    }
  }
  if (trip.rates) {
    head.push("rates:");
    for (const [code, rate] of Object.entries(trip.rates)) head.push(`  ${code}: ${rate}`);
  }
  if (trip.translations) {
    head.push("translations:");
    for (const [code, t] of Object.entries(trip.translations)) {
      head.push(`  ${code}:`);
      if (t.title) head.push(`    title: ${quote(t.title)}`);
      if (t.tagline) head.push(`    tagline: ${quote(t.tagline)}`);
    }
  }
  head.push("---", "", trip.intro, "");
  fs.writeFileSync(path.join(dir, "trip.md"), head.join("\n"));

  const costs = ["---", "budget:"];
  costs.push(`  total: ${trip.budget.total}`, `  days: ${trip.budget.days}`, `  currency: ${trip.budget.currency}`);
  costs.push("costs:");
  for (const c of trip.preparation) {
    // The category is the one the spec gives. It used to be flattened to
    // "preparation" for everything, which put a 1,120-franc flight and a pair
    // of boots in one wedge of the donut and made the chart say nothing.
    const cur = c.currency ? `, currency: ${quote(c.currency)}` : "";
    costs.push(
      `  - { label: ${quote(c.label)}, amount: ${c.amount}, category: ${quote(c.category)}${cur} }`,
    );
  }
  costs.push("---", "", trip.costsNote, "");
  fs.writeFileSync(path.join(dir, "costs.md"), costs.join("\n"));

  // A trip may write its own route — that is what an upcoming trip has instead
  // of days, and it is the only way a stop gets a `note:`. Otherwise the route
  // is derived from where the trip actually went.
  const stops =
    trip.plan ??
    // One stop per place, not one per update. A day written as three updates
    // is still one point on the route line, and it used to be three of them
    // stacked on the same coordinate — which the map draws as a marker that
    // will not go away when you click past it.
    // B736 — a fixture day is not a stop. `test: true` days exist to give the
    // travel scene a vehicle to draw, and putting the places they name on the
    // planned route would draw a journey nobody took.
    trip.days.filter((day) => !day.test).reduce((route, day) => {
      const last = route.at(-1);
      if (last && last.location === day.location && last.country === day.country) {
        return route;
      }
      route.push({
        location: day.location,
        country: day.country,
        code: day.code,
        lat: day.lat,
        lng: day.lng,
      });
      return route;
    }, []);
  const plan = ["---", "route:"];
  for (const stop of stops) {
    const note = stop.note ? `, note: ${quote(stop.note)}` : "";
    plan.push(
      `  - { location: ${quote(stop.location)}, country: ${quote(stop.country)}, countryCode: ${quote(stop.code)}, lat: ${stop.lat}, lng: ${stop.lng}${note} }`,
    );
  }
  plan.push("---", "", trip.planNote, "");
  fs.writeFileSync(path.join(dir, "plan.md"), plan.join("\n"));

  fs.mkdirSync(path.join(dir, "entries"), { recursive: true });
  for (const day of trip.days) writeEntry(trip, day);
}

/**
 * A trip whose photographs are real, committed, and of the places its days
 * name — `photos.json` beside the trip, written by
 * `scripts/fetch-demo-photos.mjs`. B211.
 *
 * Only `parks-2025` has one so far. Everywhere else still falls through to
 * Picsum below, which is fine for a trip nobody reads for its pictures but was
 * not fine for the one the README shows: it labelled a seascape "Wind Cave
 * National Park" and a frog "Laramie", and `content/example/` is also what an
 * agent reads to learn the content model — a geotagged day whose gallery has
 * nothing to do with its coordinates teaches that the two are unrelated.
 */
function committedPhotos(trip) {
  const file = path.join(SOURCE, "trips", trip.id, "photos.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")).days ?? null;
}

async function fetchPhoto(seed, shape, dest) {
  const url = `https://picsum.photos/seed/${seed}/${shape.w}/${shape.h}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function media(trip) {
  // A trip with committed photographs keeps them: re-downloading would put
  // the seascapes back. The files are in git beside the entries, so there is
  // nothing to fetch and nothing to write.
  const committed = committedPhotos(trip);
  if (committed) {
    console.log(`  photographs: kept ${Object.values(committed).flat().length} committed (photos.json)`);
    return;
  }

  for (const day of trip.days) {
    // A draft written before the trip has no photographs yet, and an empty
    // media folder is a folder somebody later wonders about.
    if (!day.photos && !day.video) continue;
    const dir = path.join(USER, "trips", trip.id, "media", day.slug);
    fs.mkdirSync(dir, { recursive: true });

    // The originals the photobook prints from. Ingest names an original after
    // its derivative rather than after the camera, which is what
    // `findOriginal` in lib/photobook/source.ts matches on, so the two files
    // share a name and differ only in which directory they are in.
    const originalsDir = path.join(USER, "trips", trip.id, "originals", day.slug);
    fs.mkdirSync(originalsDir, { recursive: true });

    for (let i = 1; i <= day.photos; i++) {
      const name = `${String(i).padStart(2, "0")}.jpg`;
      const dest = path.join(dir, name);
      const original = path.join(originalsDir, name);
      const shape = SHAPES[(i - 1) % SHAPES.length];
      const seed = `${trip.id}-${day.slug}-${i}`;
      if (!fs.existsSync(dest)) {
        await fetchPhoto(seed, shape, dest);
        process.stdout.write(".");
      }
      // Fetched separately and checked separately: a journal built before B501
      // has the derivative already, and skipping the original because of that
      // would leave it exactly as soft as it was.
      if (!fs.existsSync(original)) {
        await fetchPhoto(seed, originalShape(shape), original);
        process.stdout.write("+");
      }
    }

    if (day.video) {
      const clip = path.join(dir, "clip.mp4");
      const poster = path.join(dir, "clip.jpg");
      if (!fs.existsSync(clip)) {
        // Assembled locally from photographs already fetched: no second
        // download, nothing to license, and it proves the video path works.
        const list = path.join(dir, "frames.txt");
        const frames = fs
          .readdirSync(dir)
          .filter((f) => /^\d+\.jpg$/.test(f))
          .sort();
        fs.writeFileSync(
          list,
          frames.map((f) => `file '${f}'\nduration 2.5`).join("\n") + `\nfile '${frames.at(-1)}'\n`,
        );
        execFileSync("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0", "-i", list,
          "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p",
          "-r", "25", "-t", "10", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
          "-movflags", "+faststart", clip,
        ], { stdio: "ignore" });
        fs.rmSync(list);
        execFileSync("ffmpeg", ["-y", "-i", clip, "-frames:v", "1", "-q:v", "3", poster], {
          stdio: "ignore",
        });
        process.stdout.write("V");
      }
    }
  }
}

// Refuse to overwrite a demo journal that already exists, unless told to.
// Any one of these five trip folders already being there means a previous
// run (or B325's weather sweep, or a hand edit) has content on disk this
// script does not know how to reproduce.
if (!FORCE && TRIPS.some((trip) => fs.existsSync(path.join(USER, "trips", trip.id, "trip.md")))) {
  console.error(
    "content/example already has a demo journal. Re-running this script would overwrite " +
      "fields it does not know how to write back — weather readings, transport details, prose " +
      "edited by hand since. Pass --force to overwrite anyway, or delete content/example first " +
      "if you mean to start clean. See B556.",
  );
  process.exit(1);
}

for (const trip of TRIPS) writeTrip(trip);
console.log(`Wrote ${TRIPS.length} trips, ${TRIPS.reduce((n, t) => n + t.days.length, 0)} entries.`);

if (WITH_MEDIA) {
  process.stdout.write("media ");
  for (const trip of TRIPS) await media(trip);
  console.log("\ndone.");
} else {
  console.log("Run with --media to fetch photographs and build the clip.");
}
