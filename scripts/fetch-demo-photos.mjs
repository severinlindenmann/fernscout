#!/usr/bin/env node
// Fetch the demo journal's photographs from Wikimedia Commons, public domain
// only, and write the manifest `build-demo-content.mjs` reads. B211.
//
// The demo used to pull every photograph from Lorem Picsum by a fixed seed:
// reproducible, nothing to license, and completely unrelated to the captions.
// `/example/trips/parks-2025/gallery` labelled a seascape "Wind Cave National
// Park" and a frog "Laramie". That matters twice over — the README shows this
// trip, and `content/example/` is what an agent reads to learn the content
// model, so a geotagged day whose gallery has nothing to do with its
// coordinates quietly teaches that the two are unrelated.
//
// **Public domain only, and checked rather than assumed.** Commons' park
// categories are mostly CC BY-SA imports from Flickr, which would put an
// attribution obligation into a repository that must clone and run with no
// licence questions — the one thing B211 ruled out. So the search asks for
// `haslicense:unrestricted` and every candidate is then re-checked against
// this file's own allowlist before it is kept: a licence this script does not
// recognise is skipped, never downloaded on the assumption that the filter
// upstream was right.
//
// Run: node scripts/fetch-demo-photos.mjs [--trip parks-2025] [--dry-run]
// Needs `sips` (macOS) for the resize and `exiftool` to strip metadata.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const API = "https://commons.wikimedia.org/w/api.php";
const UA = "fernscout-demo-content/1.0 (https://fernscout.ch)";

/** Licences that carry no attribution obligation. Anything else is skipped —
 *  the point of the exercise is a demo nobody has to explain. */
const PUBLIC_DOMAIN = [/^public domain/i, /^cc0/i, /^no restrictions/i, /^pd-/i];

const WEB_EDGE = 1600;

/**
 * What each day should show. The query is the search, the `need` is how many
 * photographs that day's gallery holds, and `avoid` keeps a query from
 * returning maps, diagrams and signage — which Commons has a great many of for
 * exactly these places, and which are public domain and useless here.
 */
const DAYS = [
  { slug: "vegas-and-a-cooler", need: 2, must: /las vegas/i,
    q: ["Las Vegas Nevada strip street", "Las Vegas Boulevard Nevada"] },
  { slug: "zion-narrows", need: 3, must: /zion|virgin river/i,
    q: ["Zion National Park Virgin River Narrows canyon", "Zion National Park Utah"] },
  { slug: "bryce-at-six", need: 3, must: /bryce/i,
    q: ["Bryce Canyon National Park hoodoos amphitheater", "Bryce Canyon Utah"] },
  { slug: "escalante-backroad", need: 2, must: /escalante|utah/i,
    q: ["Grand Staircase Escalante National Monument Utah", "Escalante Utah canyon"] },
  { slug: "capitol-reef-orchard", need: 3, must: /capitol reef/i,
    q: ["Capitol Reef National Park", "Capitol Reef Utah cliffs Fruita"] },
  { slug: "goblin-valley", need: 2, must: /goblin valley/i,
    q: ["Goblin Valley State Park Utah hoodoos", "Goblin Valley Utah"] },
  { slug: "arches-at-dusk", need: 3, must: /arches|delicate arch/i,
    q: ["Arches National Park Delicate Arch sunset", "Arches National Park Utah"] },
  { slug: "needles-district", need: 2, must: /canyonlands/i,
    q: ["Canyonlands National Park Needles district", "Canyonlands National Park Utah"] },
  { slug: "monument-valley", need: 2, must: /monument valley/i,
    q: ["Monument Valley Utah buttes", "Monument Valley Navajo Tribal Park"] },
  { slug: "mesa-verde-ladders", need: 3, must: /mesa verde/i,
    q: ["Mesa Verde National Park cliff dwelling", "Mesa Verde Colorado ruins"] },
  { slug: "great-sand-dunes", need: 2, must: /sand dunes/i,
    q: ["Great Sand Dunes National Park Colorado dunes", "Great Sand Dunes Colorado"] },
  { slug: "black-canyon", need: 2, must: /black canyon|gunnison/i,
    q: ["Black Canyon of the Gunnison National Park", "Black Canyon Gunnison Colorado"] },
  { slug: "independence-pass", need: 2, must: /independence pass|aspen|sawatch|colorado/i,
    q: ["Independence Pass Colorado", "Sawatch Range Colorado mountains"] },
  { slug: "trail-ridge-road", need: 3, must: /trail ridge|rocky mountain national park/i,
    q: ["Rocky Mountain National Park alpine tundra landscape", "Rocky Mountain National Park mountains"] },
  { slug: "wyoming-nothing", need: 2, must: /wyoming/i,
    q: ["Wyoming prairie landscape", "Wyoming grassland plains highway"] },
  { slug: "badlands-loop", need: 3, must: /badlands/i,
    q: ["Badlands National Park South Dakota formations", "Badlands National Park"] },
  { slug: "wind-cave", need: 2, must: /wind cave/i,
    q: ["Wind Cave National Park South Dakota", "Wind Cave National Park bison prairie"] },
  { slug: "back-to-denver", need: 2, must: /denver/i,
    q: ["Denver Colorado skyline downtown", "Denver Colorado city buildings"] },
];

/**
 * Titles that are public domain, correctly named, and still not a photograph
 * of the place a traveller saw. Commons holds a great many of these for
 * exactly these parks: survey documentation, orbital imagery, railroad
 * archives. Each entry here was added because it actually came back from one
 * of the queries above.
 */
const AVOID =
  /\b(map|diagram|chart|sign|signage|logo|seal|poster|brochure|graph|satellite image|aerial|fema|equipment|portrait of|headquarters|culvert|bunkhouse|mess hall|habs|haer|sts\d+|from space|orbit|coversheet|obliteration|after painting|camp building|railroad|railway|rio grande|canon city|mansion|battery|alum bay)\b/i;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tripIx = args.indexOf("--trip");
const TRIP = tripIx >= 0 ? args[tripIx + 1] : "parks-2025";

const isPublicDomain = (licence) => PUBLIC_DOMAIN.some((re) => re.test(licence.trim()));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} from Commons for ${params.gsrsearch ?? ""}`);
  return res.json();
}

/**
 * Candidates for one day: public domain, big enough, not a map — and actually
 * of the place.
 *
 * The `must` test is the one that earns its place. Without it the search
 * happily returns a public-domain photograph of Steens Mountain in Oregon for
 * an Escalante day, and FEMA firefighting equipment for Denver: correctly
 * licensed, and exactly the fault this ticket is about. Swapping a random
 * wrong photograph for a specific wrong one is not progress, so a candidate
 * whose own title does not name the place is dropped, and the day is reported
 * short rather than filled.
 */
async function candidates(day) {
  const seen = new Set();
  const out = [];
  for (const query of day.q) {
    if (out.length >= day.need) break;
    const data = await api({
      action: "query",
      generator: "search",
      gsrsearch: `${query} filetype:bitmap haslicense:unrestricted`,
      gsrnamespace: "6",
      gsrlimit: "40",
      prop: "imageinfo",
      iiprop: "url|extmetadata|size",
      iiurlwidth: String(WEB_EDGE),
    });
    for (const page of Object.values(data?.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const licence = info.extmetadata?.LicenseShortName?.value ?? "";
      // Re-checked here rather than trusted from the search filter.
      if (!isPublicDomain(licence)) continue;
      const title = page.title.replace(/^File:/, "");
      if (seen.has(title)) continue;
      if (AVOID.test(title)) continue;
      if (!day.must.test(title)) continue;
      if ((info.width ?? 0) < 1200) continue;
      seen.add(title);
      out.push({
        title,
        licence,
        width: info.width,
        height: info.height,
        download: info.thumburl ?? info.url,
        page:
          info.descriptionurl ??
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      });
    }
  }
  return out;
}

function dimensions(file) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], {
    encoding: "utf8",
  });
  const w = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  return { width: w, height: h };
}

async function main() {
  const root = path.join("content", "example", "trips", TRIP);
  if (!fs.existsSync(root)) throw new Error(`no such trip: ${root}`);

  const manifest = { trip: TRIP, fetched: new Date().toISOString().slice(0, 10), days: {} };
  let total = 0;

  for (const day of DAYS) {
    const found = await candidates(day);
    const chosen = found.slice(0, day.need);
    if (chosen.length < day.need) {
      console.warn(`! ${day.slug}: wanted ${day.need}, found ${chosen.length} public-domain`);
    }
    manifest.days[day.slug] = [];
    const dir = path.join(root, "media", day.slug);

    for (const [i, pick] of chosen.entries()) {
      const name = String(i + 1).padStart(2, "0") + ".jpg";
      const target = path.join(dir, name);
      console.log(`${day.slug}/${name}  ${pick.licence.padEnd(16)} ${pick.title.slice(0, 52)}`);
      if (!dryRun) {
        fs.mkdirSync(dir, { recursive: true });
        const res = await fetch(pick.download, { headers: { "User-Agent": UA } });
        if (!res.ok) throw new Error(`${res.status} downloading ${pick.title}`);
        fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
        // Longest edge to WEB_EDGE, then strip everything a camera left behind
        // — the demo journal should not ship somebody else's GPS tags.
        execFileSync("sips", ["-Z", String(WEB_EDGE), target], { stdio: "ignore" });
        execFileSync("exiftool", ["-all=", "-overwrite_original", target], { stdio: "ignore" });
      }
      const size = dryRun ? { width: pick.width, height: pick.height } : dimensions(target);
      manifest.days[day.slug].push({
        file: name,
        ...size,
        title: pick.title,
        licence: pick.licence,
        source: pick.page,
      });
      total += 1;
    }
  }

  const out = path.join(root, "photos.json");
  if (!dryRun) fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\n${total} photographs, all public domain. Manifest: ${out}`);
}

await main();
