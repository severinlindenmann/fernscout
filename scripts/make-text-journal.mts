/**
 * Builds a test journal whose days differ only in how much was written.
 *
 *   npx tsx --conditions=react-server scripts/make-text-journal.mts --out /tmp/labcontent
 *
 * Why this exists: every real journal in this project's world has short days —
 * a median of 38 words and nothing above 160 — so a text form that only shows
 * its worth at 400 words cannot be judged against real content at all. This
 * makes the missing case rather than waiting for somebody to write it.
 *
 * The journal is named `test-textlaengen` and every day carries `test: true`,
 * which is the one exception AGENTS.md allows for invented content: the label
 * survives exports and backups, and nobody can mistake these days for a
 * person's memories. The prose is deliberately flat and repetitive for the
 * same reason — it is measuring tape, not writing.
 *
 * Photographs are generated, not copied: flat colour fields with their own
 * dimensions printed on them. A real photograph would make the page prettier
 * and the judgement worse, because the question here is where the text goes.
 */

import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { validateEntry } from "../lib/validate/entry.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const out = path.resolve(arg("out") ?? "/tmp/labcontent");
const user = arg("user") ?? "test";
const trip = "test-textlaengen";
const root = path.join(out, user, "trips", trip);
fs.mkdirSync(path.join(root, "entries"), { recursive: true });
fs.mkdirSync(path.join(root, "media"), { recursive: true });

/** Flat, repetitive, and obviously not a person's writing. */
const SENTENCES = [
  "Dieser Satz ist Messband und keine Erinnerung.",
  "Er steht hier, damit die Spalte eine Länge bekommt.",
  "Die Wörter zählen, der Inhalt nicht.",
  "Eine weitere Zeile, damit der Umbruch etwas zu tun hat.",
  "Auch dieser Absatz dient nur der Messung.",
  "Er ist absichtlich langweilig geschrieben.",
];

function words(n: number): string {
  const parts: string[] = [];
  let count = 0;
  let i = 0;
  while (count < n) {
    const s = SENTENCES[i % SENTENCES.length];
    parts.push(s);
    count += s.split(/\s+/).length;
    i++;
    // A paragraph break every four sentences, so the forms that care about
    // paragraphs have some to work with.
    if (i % 4 === 0) parts.push("\n\n");
  }
  return parts.join(" ").replace(/ \n\n /g, "\n\n").trim();
}

const LENGTHS = [
  { n: 12, label: "Sehr kurz" },
  { n: 40, label: "Kurz" },
  { n: 90, label: "Mittel" },
  { n: 200, label: "Lang" },
  { n: 450, label: "Sehr lang" },
  { n: 900, label: "Ausufernd" },
];

const PHOTO_SHAPES = [
  { w: 2400, h: 1600, tag: "quer" },
  { w: 1600, h: 2400, tag: "hoch" },
  { w: 2000, h: 2000, tag: "quadrat" },
  { w: 3600, h: 1200, tag: "panorama" },
];

async function photo(dir: string, name: string, w: number, h: number, tint: number): Promise<void> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
       <rect width="${w}" height="${h}" fill="hsl(${tint},38%,62%)"/>
       <text x="${w / 2}" y="${h / 2}" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 8)}"
             fill="rgba(0,0,0,.45)" text-anchor="middle" dominant-baseline="middle">${w}×${h}</text>
     </svg>`,
  );
  await sharp(svg).jpeg({ quality: 82 }).toFile(path.join(dir, name));
}

let day = 1;
const photoCounts = [0, 1, 2, 3, 4, 1];

for (const [i, len] of LENGTHS.entries()) {
  const date = `2026-03-${String(day).padStart(2, "0")}`;
  const slug = `${date}-${len.label.toLowerCase().replace(/\s+/g, "-")}`;
  const mediaDir = path.join(root, "media", slug);
  fs.mkdirSync(mediaDir, { recursive: true });

  const count = photoCounts[i % photoCounts.length];
  const media: unknown[] = [];
  for (let p = 0; p < count; p++) {
    const shape = PHOTO_SHAPES[(i + p) % PHOTO_SHAPES.length];
    const name = `${String(p + 1).padStart(2, "0")}-${shape.tag}.jpg`;
    await photo(mediaDir, name, shape.w, shape.h, (i * 47 + p * 23) % 360);
    media.push({
      src: `/media/${trip}/${slug}/${name}`,
      type: "image",
      width: shape.w,
      height: shape.h,
      ...(p === 0 ? { caption: `Bildunterschrift, ${shape.tag}` } : {}),
    });
  }

  const entry = {
    title: `${len.label} — ${len.n} Wörter`,
    date,
    timezone: "Europe/Zurich",
    location: `Messpunkt ${day}`,
    country: "Schweiz",
    countryCode: "CH",
    coordinates: { lat: 47.0 + day * 0.12, lng: 8.0 + day * 0.21 },
    status: "published",
    content: words(len.n),
    media,
    test: true,
  };

  // B112: a script that writes an entry file runs its frontmatter past the
  // same validator the REST route does, so the field checks have one door and
  // not two. A measuring-stick journal is no exception — if these days would
  // be refused over the API, they are the wrong thing to measure against.
  //
  // The validator takes the coordinate flat, the way the route receives it —
  // and it refuses a `coordinates` key holding a position at all, because over
  // the API that key means only "no one place" or "nobody can say where". The
  // file on disk nests it, the way every other entry stores it. So the flat
  // shape is what gets checked, which is what the route would check.
  const { coordinates, ...flat } = entry;
  const problems = validateEntry({ ...flat, lat: coordinates.lat, lng: coordinates.lng });
  if (problems.length) {
    console.error(`${slug} would be refused:`);
    for (const p of problems) console.error(`  ${p.field}: got ${p.got}, expected ${p.expected}`);
    process.exit(1);
  }

  fs.writeFileSync(path.join(root, "entries", `${slug}.json`), JSON.stringify(entry, null, 2) + "\n");
  day += 1;
}

fs.writeFileSync(
  path.join(root, "trip.json"),
  JSON.stringify(
    {
      id: trip,
      title: "Textlängen",
      dates: { from: "2026-03-01", to: `2026-03-0${LENGTHS.length}` },
      visibility: "private",
      test: true,
    },
    null,
    2,
  ) + "\n",
);

fs.mkdirSync(path.join(out, user), { recursive: true });
const configPath = path.join(out, user, "config.json");
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        title: "Textlängen-Prüfstand",
        owner: { name: "Messgerät", nickname: "Messgerät" },
        visibility: "private",
        defaultLocale: "de",
        locales: ["de"],
        baseCurrency: "CHF",
        units: "metric",
      },
      null,
      2,
    ) + "\n",
  );
}

console.log(`${LENGTHS.length} Tage in ${root}`);
for (const len of LENGTHS) console.log(`  ${len.label}: ${len.n} Wörter`);
