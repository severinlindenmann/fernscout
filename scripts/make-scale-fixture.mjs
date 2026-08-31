// Builds a synthetic content tree with a trip of N days.
//
//   node scripts/make-scale-fixture.mjs <out-dir> <days>
//
// It is a measuring stick, not demo content: every day is a realistic average
// of the real entries — roughly the same prose length, two gallery images,
// three cost lines and two translations — so the bytes-per-day figure it
// produces means something. Used by scripts/measure-payload.mjs and by
// test/payload.test.ts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACES = [
  ["Bangkok", "Thailand", "TH", 13.7563, 100.5018],
  ["Chiang Mai", "Thailand", "TH", 18.7883, 98.9853],
  ["Hanoi", "Vietnam", "VN", 21.0278, 105.8342],
  ["Hue", "Vietnam", "VN", 16.4637, 107.5909],
  ["Hoi An", "Vietnam", "VN", 15.8801, 108.338],
  ["Phnom Penh", "Cambodia", "KH", 11.5564, 104.9282],
  ["Luang Prabang", "Laos", "LA", 19.8845, 102.135],
  ["Kuala Lumpur", "Malaysia", "MY", 3.139, 101.6869],
];
const MODES = ["train", "bus", "flight", "boat", "motorbike"];

/** One day's prose. Distinctive enough to grep the rendered page for. */
export const SCALE_PROSE =
  "Twelve hours north on the night train, bunks folded down by the conductor " +
  "around nine, and breakfast served as the rice fields outside turned gold " +
  "with the sunrise. Genuinely one of the best ways to cover distance we have " +
  "ever experienced, and cheaper than the flight would have been.";

function pad(n) {
  return String(n).padStart(2, "0");
}

/** yyyy-mm-dd, `i` days after 2026-08-14. */
export function scaleDate(i) {
  const d = new Date(Date.UTC(2026, 7, 14) + i * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Writes a content tree with a `traveller/scale` trip of `dayCount` days. */
export function makeScaleFixture(out, dayCount) {
  fs.rmSync(out, { recursive: true, force: true });
  const entries = path.join(out, "traveller", "trips", "scale", "entries");
  fs.mkdirSync(entries, { recursive: true });

  // The ECB snapshot is instance-wide rather than per user; the currency
  // switcher wants one and the real content directory already has it.
  const rates = path.join(process.cwd(), "content", "rates");
  if (fs.existsSync(rates)) fs.cpSync(rates, path.join(out, "rates"), { recursive: true });

  fs.writeFileSync(
    path.join(out, "config.json"),
    JSON.stringify(
      {
        configVersion: 1,
        site: { name: "Scale", url: "https://example.com", defaultUser: "traveller" },
        users: { reserved: ["api", "media", "_next"] },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(out, "traveller", "config.json"),
    JSON.stringify(
      {
        title: "Scale",
        tagline: "A trip long enough to measure",
        owner: { name: "A Traveller", nickname: "A" },
        startLocation: "Zurich, Switzerland",
        defaultLocale: "en",
        locales: ["en", "de", "hu"],
        baseCurrency: "CHF",
        displayCurrencies: ["CHF", "EUR"],
        units: "metric",
        features: { reactions: { enabled: true }, costs: { enabled: true } },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(out, "traveller", "trips", "scale", "trip.md"),
    `---
id: scale
title: "A long trip"
tagline: "Long enough to measure"
start: "${scaleDate(0)}"
end: "${scaleDate(dayCount - 1)}"
status: current
accent: sky
---

A trip generated to measure how the story page grows.
`,
  );

  for (let i = 0; i < dayCount; i++) {
    const [location, country, code, lat, lng] = PLACES[i % PLACES.length];
    const date = scaleDate(i);
    const mode = MODES[i % MODES.length];
    const prev = PLACES[(i - 1 + PLACES.length) % PLACES.length][0];
    fs.writeFileSync(
      path.join(entries, `${date}-day-${i + 1}.md`),
      `---
title: "Day ${i + 1} in ${location}"
date: "${date}"
time: "0${(i % 9) + 1}:15"
location: "${location}"
country: "${country}"
countryCode: "${code}"
lat: ${lat}
lng: ${lng}
transportMode: "${mode}"
transportFrom: "${prev}"
transportTo: "${location}"
gallery:
  - src: "/media/scale/${i}/01.jpg"
    type: "image"
    width: 1200
    height: 800
    caption: "Something worth stopping for on day ${i + 1}"
  - src: "/media/scale/${i}/02.jpg"
    type: "image"
    width: 800
    height: 1200
    caption: "The other thing worth stopping for on day ${i + 1}"
tags: ["${mode}", "${country.toLowerCase()}"]
costs:
  - label: "Beds for the night"
    amount: ${20 + (i % 40)}
    category: "accommodation"
  - label: "Food, all of it"
    amount: ${10 + (i % 25)}
    category: "food"
  - label: "Getting there by ${mode}"
    amount: ${5 + (i % 60)}
    category: "transport"
translations:
  de:
    title: "Tag ${i + 1} in ${location}"
    content: |
      ${SCALE_PROSE}
  hu:
    title: "${i + 1}. nap ${location}"
    content: |
      ${SCALE_PROSE}
---

${SCALE_PROSE}
`,
    );
  }
  return out;
}

// CLI: node scripts/make-scale-fixture.mjs <out-dir> <days>
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  const dayCount = Number(process.argv[3] ?? 200);
  if (!out) {
    console.error("usage: node scripts/make-scale-fixture.mjs <out-dir> <days>");
    process.exit(1);
  }
  makeScaleFixture(out, dayCount);
  console.log(`wrote ${dayCount} days to ${out}`);
}
