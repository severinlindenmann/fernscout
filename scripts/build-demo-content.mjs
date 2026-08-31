// Builds the demo journal: three trips, real photographs, one short clip.
//
//   node scripts/build-demo-content.mjs            # entries only, offline
//   node scripts/build-demo-content.mjs --media    # also fetch photos, make the clip
//
// This is the content a fresh clone sees at /example, and it is what the test
// guide walks through. It exists as a script rather than as committed prose so
// the shape of a trip stays regenerable while the project is still moving.
//
// Photographs come from Lorem Picsum, which serves Unsplash images; every one
// is requested by a fixed seed so a rebuild produces the same journal rather
// than a different one. The video clip is assembled locally with ffmpeg from
// photographs already fetched — no second download, and nothing to license.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const USER = path.join(ROOT, "content", "example");
const WITH_MEDIA = process.argv.includes("--media");

/** Landscape, portrait and square, so the gallery and the book have to cope. */
const SHAPES = [
  { w: 1600, h: 1067 },
  { w: 1600, h: 1067 },
  { w: 1067, h: 1600 },
  { w: 1400, h: 1400 },
];

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
    visibility: "public",
    costsVisibility: "public",
    intro:
      "Four days, one borrowed car, and a loop over three passes. Short enough that we never unpacked properly, long enough that we stopped talking about work.",
    rates: { EUR: 0.94 },
    budget: { total: 900, days: 4, currency: "CHF" },
    preparation: [
      { label: "Vignette and tolls", amount: 90, category: "transport" },
      { label: "Roof box hire", amount: 60, category: "gear" },
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
        costs: [
          { label: "Fuel", amount: 78, category: "transport" },
          { label: "Lunch at the pass", amount: 46, category: "food" },
        ],
        text: "We left Zurich late and regretted it for exactly as long as it took to get past Lucerne. The Susten is the kind of road that makes a borrowed estate car feel like a much better car than it is.\n\nAt the top there was a hut selling soup and one flavour of cake. We had both, twice.",
        de: "Wir sind spät aus Zürich losgefahren und haben das genau so lange bereut, bis wir Luzern hinter uns hatten. Der Susten ist die Sorte Straße, die einen geliehenen Kombi deutlich besser wirken lässt, als er ist.\n\nOben gab es eine Hütte mit Suppe und genau einer Sorte Kuchen. Wir hatten beides, zweimal.",
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
        costs: [
          { label: "Guesthouse", amount: 145, category: "accommodation" },
          { label: "Dinner", amount: 62, category: "food" },
        ],
        text: "Rain the whole way up and cloud so low the reservoir looked like the edge of the world. We had the viewpoint entirely to ourselves, which is one way to sell bad weather.\n\nThe guesthouse had one other guest, a cyclist who had ridden up in it on purpose.",
      },
      {
        date: "2024-09-14",
        slug: "into-italy",
        title: "A wrong turn into Italy",
        location: "Domodossola",
        country: "Italy",
        code: "IT",
        lat: 46.1161,
        lng: 8.2939,
        transport: { mode: "car", from: "Grimsel Pass", to: "Domodossola" },
        photos: 3,
        costs: [
          { label: "Coffee and pastries", amount: 11, category: "food", currency: "EUR" },
          { label: "Groceries", amount: 34, category: "food", currency: "EUR" },
        ],
        text: "Not really a wrong turn — we just kept going down the wrong side of the mountain and found ourselves buying coffee in euros. Nobody minded.\n\nA market was packing up in the square. We bought tomatoes we had nowhere to cook and ate them like apples in the car park.",
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
    visibility: "public",
    costsVisibility: "public",
    intro:
      "Five months from Bangkok to Hanoi, overland the whole way. We had a rough plan for the first fortnight and made the rest up on station platforms.",
    rates: { THB: 0.0258, VND: 0.0000372, EUR: 0.98 },
    budget: { total: 18000, days: 146, currency: "CHF" },
    preparation: [
      { label: "Flights to Bangkok", amount: 1120, category: "transport" },
      { label: "Travel insurance, six months", amount: 480, category: "admin" },
      { label: "Rucksacks", amount: 390, category: "gear" },
    ],
    days: [
      {
        date: "2023-01-09",
        slug: "bangkok-first-morning",
        title: "First morning in Bangkok",
        location: "Bangkok",
        country: "Thailand",
        code: "TH",
        lat: 13.7563,
        lng: 100.5018,
        photos: 4,
        costs: [
          { label: "Street noodles", amount: 120, category: "food", currency: "THB" },
          { label: "Guesthouse", amount: 900, category: "accommodation", currency: "THB" },
        ],
        text: "Landed at six, asleep by eight, awake at three in the morning entirely convinced it was lunchtime. By the time it actually was lunchtime we had been walking for four hours and eaten twice.\n\nThe heat is not the thing people warn you about. The thing is the noise, and how quickly you stop hearing it.",
        de: "Um sechs gelandet, um acht geschlafen, um drei Uhr nachts hellwach und fest überzeugt, es sei Mittag. Als es dann wirklich Mittag war, waren wir vier Stunden gelaufen und hatten zweimal gegessen.\n\nDie Hitze ist nicht das, wovor die Leute warnen. Es ist der Lärm — und wie schnell man ihn nicht mehr hört.",
        hu: "Hatkor landoltunk, nyolckor aludtunk, hajnali háromkor pedig teljesen éberen, abban a hitben, hogy dél van. Mire tényleg dél lett, négy órát gyalogoltunk és kétszer ettünk.\n\nNem a hőség az, amire figyelmeztetnek. Hanem a zaj — és hogy milyen gyorsan nem hallod meg többé.",
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
        photos: 3,
        costs: [
          { label: "Sleeper berth", amount: 881, category: "transport", currency: "THB" },
          { label: "Breakfast on board", amount: 90, category: "food", currency: "THB" },
        ],
        text: "Thirteen hours, a bunk with a curtain, and a man with a trolley who appeared every ninety minutes whether or not anybody wanted anything.\n\nWoke somewhere past Lampang with the window full of green and no idea what time it was. Best sleep of the trip so far.",
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
        video: true,
        costs: [
          { label: "Slow boat, two days", amount: 78, category: "transport" },
          { label: "Night in Pakbeng", amount: 22, category: "accommodation" },
        ],
        text: "Two days on a wooden boat with a car engine bolted into the back of it. There is nothing to do, which is the entire point and takes about four hours to understand.\n\nWe filmed ten seconds of the bank going past on the second afternoon. It is the only video either of us took the whole trip and it is somehow the thing we show people first.",
        de: "Zwei Tage auf einem Holzboot mit einem hinten eingebauten Automotor. Es gibt nichts zu tun, was der ganze Sinn der Sache ist und ungefähr vier Stunden dauert, bis man es versteht.\n\nAm zweiten Nachmittag haben wir zehn Sekunden Ufer gefilmt. Es ist das einzige Video der ganzen Reise — und trotzdem das Erste, was wir den Leuten zeigen.",
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
        photos: 4,
        costs: [
          { label: "Motorbike transfer", amount: 1150000, category: "transport", currency: "VND" },
          { label: "Tailored shirt", amount: 620000, category: "other", currency: "VND" },
        ],
        text: "Rode the pass on the back of somebody else's motorbike with our bags strapped to a third one. It rained at the top and cleared before the bottom, which everyone had told us it would.\n\nHoi An is lit entirely by paper lanterns after dark, and it is exactly as good as that sounds.",
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
        transport: { mode: "train", from: "Hoi An", to: "Hanoi" },
        photos: 3,
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
    visibility: "public",
    costsVisibility: "public",
    intro:
      "Six months and a second-hand pickup, starting in Denver and going wherever the forest roads do. Still out there — this one is being written as it happens.",
    rates: { USD: 0.88 },
    budget: { total: 26000, days: 173, currency: "CHF" },
    preparation: [
      { label: "Flights to Denver", amount: 980, category: "transport" },
      { label: "The truck", amount: 9400, category: "transport" },
      { label: "Tent, stove, the rest of it", amount: 1250, category: "gear" },
    ],
    days: [
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
        costs: [
          { label: "Motel, two nights", amount: 210, category: "accommodation", currency: "USD" },
          { label: "Registration and plates", amount: 165, category: "admin", currency: "USD" },
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
        costs: [
          { label: "Fuel", amount: 96, category: "transport", currency: "USD" },
          { label: "Campground, four nights", amount: 80, category: "accommodation", currency: "USD" },
          { label: "Groceries", amount: 143, category: "food", currency: "USD" },
        ],
        text: "The truck made it, loudly. Four nights on a bluff outside town with nobody else on it, which cost twenty dollars a night and felt like theft.\n\nIt is hard to photograph and we tried anyway, several hundred times.",
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
        photos: 3,
        costs: [
          { label: "Fuel", amount: 121, category: "transport", currency: "USD" },
          { label: "New tyre", amount: 218, category: "transport", currency: "USD" },
        ],
        text: "Fires two valleys over turned the light orange for a week. Beautiful in a way that makes you feel bad about finding it beautiful.\n\nPicked up a nail on a forest road and learned that a tyre shop in a small town will fit you in the same afternoon if you are pleasant about it.",
      },
      {
        date: "2026-08-24",
        slug: "oregon-coast",
        title: "Down the Oregon coast",
        location: "Cannon Beach",
        country: "United States",
        code: "US",
        lat: 45.8918,
        lng: -123.9615,
        transport: { mode: "car", from: "Bishop", to: "Cannon Beach" },
        photos: 4,
        costs: [
          { label: "Fuel", amount: 88, category: "transport", currency: "USD" },
          { label: "Crab, from a shack", amount: 34, category: "food", currency: "USD" },
        ],
        text: "Cold, grey, and the best week so far. The Pacific here does not look like a holiday; it looks like weather that has come a very long way to arrive.\n\nSlept in the truck twice because the tent was wet and neither of us could face it.",
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
    visibility: "public",
    costsVisibility: "public",
    intro:
      "A rental sedan, a cooler, and a national parks pass that paid for itself by the fourth gate. Las Vegas to Denver by way of Utah, Colorado and the Dakotas — eighteen nights, and never twice in the same bed.",
    rates: { USD: 0.8 },
    budget: { total: 7200, days: 18, currency: "CHF" },
    preparation: [
      { label: "Flights to Las Vegas", amount: 1120, category: "transport" },
      { label: "Car hire, eighteen days", amount: 940, category: "transport" },
      { label: "Annual parks pass", amount: 72, category: "admin" },
    ],
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
        costs: [
          { label: "Motel by the airport", amount: 96, category: "accommodation", currency: "USD" },
          { label: "Cooler, ice, two weeks of coffee", amount: 61, category: "gear", currency: "USD" },
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
        costs: [
          { label: "Fuel", amount: 44, category: "transport", currency: "USD" },
          { label: "Cabin in Springdale", amount: 168, category: "accommodation", currency: "USD" },
          { label: "Dry bags and sticks, hired", amount: 52, category: "gear", currency: "USD" },
        ],
        text: "Three hours of walking up a river between walls three hundred metres high, with the water somewhere between knee and waist depending on how well you read the gravel.\n\nEverybody in the canyon was quiet. Not reverent — just concentrating on their feet.",
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
        costs: [
          { label: "Fuel", amount: 43, category: "transport", currency: "USD" },
          { label: "Campground", amount: 20, category: "accommodation", currency: "USD" },
        ],
        text: "An hour and a half off the highway to reach the quiet half of Canyonlands. We saw four other cars all day and two of them were rangers.\n\nStars afterwards of the kind that make the sky look crowded rather than empty.",
      },
      {
        date: "2025-09-13",
        slug: "monument-valley",
        title: "Monument Valley in the wrong light",
        location: "Monument Valley",
        country: "United States",
        code: "US",
        lat: 36.9980,
        lng: -110.0985,
        transport: { mode: "car", from: "Needles District", to: "Monument Valley" },
        photos: 2,
        costs: [
          { label: "Fuel", amount: 47, category: "transport", currency: "USD" },
          { label: "Tribal park entry", amount: 20, category: "admin", currency: "USD" },
          { label: "Room on the rim", amount: 195, category: "accommodation", currency: "USD" },
        ],
        text: "Arrived at midday, when the buttes are flat and grey and look like a postcard left in a window. Waited six hours and got the other version.\n\nThis is Navajo land, not a national park, and it is run entirely differently — better signposted about what you may not photograph.",
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
];

// --------------------------------------------------------------------------

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function galleryBlock(trip, day) {
  const items = [];
  for (let i = 1; i <= day.photos; i++) {
    const shape = SHAPES[(i - 1) % SHAPES.length];
    items.push(
      `  - src: "/media/${trip.id}/${day.slug}/${String(i).padStart(2, "0")}.jpg"\n` +
        `    type: "image"\n    width: ${shape.w}\n    height: ${shape.h}`,
    );
  }
  if (day.video) {
    items.push(
      `  - src: "/media/${trip.id}/${day.slug}/clip.mp4"\n` +
        `    type: "video"\n    width: 1280\n    height: 720\n` +
        `    caption: "Ten seconds of the bank going past"`,
    );
  }
  return items.join("\n");
}

function writeEntry(trip, day) {
  const lines = [
    "---",
    `title: ${quote(day.title)}`,
    `date: ${quote(day.date)}`,
    `location: ${quote(day.location)}`,
    `country: ${quote(day.country)}`,
    `countryCode: ${quote(day.code)}`,
    `lat: ${day.lat}`,
    `lng: ${day.lng}`,
  ];
  if (day.transport) {
    lines.push(
      `transportMode: ${quote(day.transport.mode)}`,
      `transportFrom: ${quote(day.transport.from)}`,
      `transportTo: ${quote(day.transport.to)}`,
    );
  }
  lines.push("gallery:", galleryBlock(trip, day));
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
      if (!day[code]) continue;
      lines.push(`  ${code}:`);
      lines.push(`    content: |`);
      for (const line of day[code].split("\n")) lines.push(`      ${line}`);
    }
  }
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
    `visibility: ${trip.visibility}`,
    `costsVisibility: ${trip.costsVisibility}`,
  ];
  if (trip.rates) {
    head.push("rates:");
    for (const [code, rate] of Object.entries(trip.rates)) head.push(`  ${code}: ${rate}`);
  }
  head.push("---", "", trip.intro, "");
  fs.writeFileSync(path.join(dir, "trip.md"), head.join("\n"));

  const costs = ["---", "budget:"];
  costs.push(`  total: ${trip.budget.total}`, `  days: ${trip.budget.days}`, `  currency: ${trip.budget.currency}`);
  costs.push("costs:");
  for (const c of trip.preparation) {
    costs.push(`  - { label: ${quote(c.label)}, amount: ${c.amount}, category: "preparation" }`);
  }
  costs.push("---", "", "What it took to get out of the door.", "");
  fs.writeFileSync(path.join(dir, "costs.md"), costs.join("\n"));

  const plan = ["---", "route:"];
  for (const day of trip.days) {
    plan.push(
      `  - { location: ${quote(day.location)}, country: ${quote(day.country)}, countryCode: ${quote(day.code)}, lat: ${day.lat}, lng: ${day.lng} }`,
    );
  }
  plan.push("---", "", "The route as we sketched it before leaving.", "");
  fs.writeFileSync(path.join(dir, "plan.md"), plan.join("\n"));

  for (const day of trip.days) writeEntry(trip, day);
}

async function fetchPhoto(seed, shape, dest) {
  const url = `https://picsum.photos/seed/${seed}/${shape.w}/${shape.h}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function media(trip) {
  for (const day of trip.days) {
    const dir = path.join(USER, "trips", trip.id, "media", day.slug);
    fs.mkdirSync(dir, { recursive: true });

    for (let i = 1; i <= day.photos; i++) {
      const dest = path.join(dir, `${String(i).padStart(2, "0")}.jpg`);
      if (fs.existsSync(dest)) continue;
      const shape = SHAPES[(i - 1) % SHAPES.length];
      await fetchPhoto(`${trip.id}-${day.slug}-${i}`, shape, dest);
      process.stdout.write(".");
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

for (const trip of TRIPS) writeTrip(trip);
console.log(`Wrote ${TRIPS.length} trips, ${TRIPS.reduce((n, t) => n + t.days.length, 0)} entries.`);

if (WITH_MEDIA) {
  process.stdout.write("media ");
  for (const trip of TRIPS) await media(trip);
  console.log("\ndone.");
} else {
  console.log("Run with --media to fetch photographs and build the clip.");
}
