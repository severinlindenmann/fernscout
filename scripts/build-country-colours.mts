// Bakes a fixed ISO 3166-1 alpha-2 → fill-colour table into
// lib/countryColours.json, and the adjacency graph it was coloured against
// into lib/countryAdjacency.json (kept only so test/country-colours.test.ts
// can check "no two neighbours share a colour" and "stable when a country is
// added" without a network fetch of its own).
//
// B2491, decision 1 and "Colours" in
// docs/plans/2026-09-27-reisen-continent-switch.md. The retired
// lib/flagColours.ts (git: d8f96b0^) assigned colours from the *visited*
// subset, in the order a journal happened to list its trips — adding one
// trip could recolour every country already on the map, and the "already
// taken" list it checked against was every other colour handed out so far,
// not a country's actual geographic neighbours. This script instead colours
// the whole world once, in a fixed order, checking only real borders — so
// the table never depends on who is asking, and adding a country later never
// changes anyone else's colour.
//
// One network fetch, run-once: mledoze/countries (ODbL) for the border list
// Natural Earth's own admin-0 file does not carry. Nothing here ships to the
// browser except the two committed JSON tables.
// Run with: npm run build:countrycolours
import fs from "node:fs";
import path from "node:path";
import worldCountries from "../lib/worldCountries.json" with { type: "json" };

const ROOT = path.join(import.meta.dirname, "..");
const COLOURS_FILE = path.join(ROOT, "lib", "countryColours.json");
const ADJACENCY_FILE = path.join(ROOT, "lib", "countryAdjacency.json");

const BORDERS_URL = "https://raw.githubusercontent.com/mledoze/countries/master/dist/countries.json";

/**
 * Two flag hues per ISO 3166-1 alpha-2 code — a preferred one and a fallback
 * — carried over verbatim from the retired `lib/flagColours.ts` (git:
 * d8f96b0^), which is the brief's named source. Only the *hue* survives past
 * `hueOf` below; the exact hex here is never drawn.
 */
const FLAG_COLOURS: Record<string, [string, string]> = {
  AL: ["#E41E20", "#000000"], AD: ["#10069F", "#D0103A"], AT: ["#C8102E", "#7A0C1F"],
  BY: ["#C8102E", "#4AA657"], BE: ["#FDDA24", "#C8102E"], BA: ["#002395", "#FDDA24"],
  BG: ["#00966E", "#D62612"], HR: ["#171796", "#C8102E"], CY: ["#D57800", "#4E5B31"],
  CZ: ["#11457E", "#D7141A"], DK: ["#C8102E", "#8C0A20"], EE: ["#0072CE", "#111111"],
  FI: ["#003580", "#0057B7"], FR: ["#0055A4", "#EF4135"], DE: ["#111111", "#DD0000"],
  GR: ["#0D5EAF", "#08427A"], HU: ["#477050", "#CE2939"], IS: ["#02529C", "#DC1E35"],
  IE: ["#169B62", "#FF883E"], IT: ["#008C45", "#CD212A"], XK: ["#244AA5", "#D0A650"],
  LV: ["#9E3039", "#6E2028"], LI: ["#002B7F", "#CE1126"], LT: ["#FDB913", "#006A44"],
  LU: ["#00A1DE", "#ED2939"], MT: ["#CF142B", "#8C0A20"], MD: ["#0046AE", "#CC092F"],
  MC: ["#CE1126", "#8C0A20"], ME: ["#C40308", "#D4AF37"], NL: ["#AE1C28", "#21468B"],
  MK: ["#D20000", "#FFE600"], NO: ["#BA0C2F", "#00205B"], PL: ["#DC143C", "#9E0E2B"],
  PT: ["#046A38", "#DA291C"], RO: ["#FCD116", "#002B7F"], RU: ["#0039A6", "#D52B1E"],
  SM: ["#5EB6E4", "#3E8FB8"], RS: ["#C6363C", "#0C4076"], SK: ["#0B4EA2", "#EE1C25"],
  SI: ["#005DA4", "#ED1C24"], ES: ["#C60B1E", "#FFC400"], SE: ["#006AA7", "#FECC00"],
  CH: ["#DA291C", "#A81E14"], UA: ["#0057B7", "#FFD700"], GB: ["#012169", "#C8102E"],
  VA: ["#FFE000", "#B8A100"],
  AR: ["#74ACDF", "#F6B40E"], BS: ["#00778B", "#FFC72C"], BB: ["#00267F", "#FFC726"],
  BZ: ["#003F87", "#CE1126"], BO: ["#D52B1E", "#007934"], BR: ["#009C3B", "#FFDF00"],
  CA: ["#D80621", "#A00518"], CL: ["#0039A6", "#D52B1E"], CO: ["#FCD116", "#003893"],
  CR: ["#002B7F", "#CE1126"], CU: ["#002A8F", "#CF142B"], DO: ["#002D62", "#CE1126"],
  EC: ["#FFDD00", "#034EA2"], SV: ["#0F47AF", "#0B3585"], GT: ["#4997D0", "#3A7BAC"],
  GY: ["#009E49", "#FCD116"], HT: ["#00209F", "#D21034"], HN: ["#0073CF", "#005AA3"],
  JM: ["#009B3A", "#FED100"], MX: ["#006847", "#CE1126"], NI: ["#0067C6", "#0050A0"],
  PA: ["#005293", "#DA121A"], PY: ["#D52B1E", "#0038A8"], PE: ["#D91023", "#A80D1B"],
  PR: ["#0050F0", "#ED0000"], SR: ["#377E3F", "#B40A2D"], TT: ["#DA1A35", "#000000"],
  US: ["#3C3B6E", "#B22234"], UY: ["#0038A8", "#FCD116"], VE: ["#FFCC00", "#00247D"],
  GF: ["#0055A4", "#EF4135"],
  DZ: ["#006233", "#D21034"], AO: ["#CE1126", "#000000"], BJ: ["#008751", "#FCD116"],
  BW: ["#75AADB", "#000000"], BF: ["#EF2B2D", "#009E49"], BI: ["#CE1126", "#1EB53A"],
  CM: ["#007A5E", "#CE1126"], CV: ["#003893", "#CF2027"], CF: ["#003082", "#289728"],
  TD: ["#002664", "#C60C30"], KM: ["#3A75C4", "#3D8E33"], CD: ["#007FFF", "#F7D618"],
  CG: ["#009543", "#FBDE4A"], CI: ["#F77F00", "#009E60"], DJ: ["#6AB2E7", "#12AD2B"],
  EG: ["#C09300", "#CE1126"], GQ: ["#3E9A00", "#0073CE"], ER: ["#4189DD", "#EA0437"],
  ET: ["#078930", "#FCDD09"], GA: ["#009E60", "#FCD116"], GM: ["#CE1126", "#0C1C8C"],
  GH: ["#006B3F", "#FCD116"], GN: ["#CE1126", "#009460"], GW: ["#CE1126", "#FCD116"],
  KE: ["#006600", "#BB0000"], LS: ["#00209F", "#009543"], LR: ["#002868", "#BF0A30"],
  LY: ["#239E46", "#E70013"], MG: ["#007E3A", "#FC3D32"], MW: ["#21873B", "#CE1126"],
  ML: ["#14B53A", "#FCD116"], MR: ["#006233", "#FFC400"], MU: ["#EA2839", "#1A206D"],
  MA: ["#C1272D", "#006233"], MZ: ["#007168", "#FCE100"], NA: ["#003580", "#009543"],
  NE: ["#0DB02B", "#E05206"], NG: ["#008751", "#00603A"], RW: ["#20603D", "#00A1DE"],
  ST: ["#12AD2B", "#FFCE00"], SN: ["#00853F", "#FDEF42"], SC: ["#003F87", "#D62828"],
  SL: ["#1EB53A", "#0072C6"], SO: ["#4189DD", "#3172B8"], ZA: ["#007A4D", "#DE3831"],
  SS: ["#078930", "#0F47AF"], SD: ["#007229", "#D21034"], SZ: ["#3E5EB9", "#B10C0C"],
  TZ: ["#1EB53A", "#00A3DD"], TG: ["#006A4E", "#FFCE00"], TN: ["#E70013", "#B8000F"],
  UG: ["#FCDC04", "#D90000"], EH: ["#007A3D", "#C4111B"], ZM: ["#198A00", "#EF7D00"],
  ZW: ["#319208", "#FFD200"],
  AF: ["#007A36", "#D32011"], AM: ["#0033A0", "#D90012"], AZ: ["#00B5E2", "#EF3340"],
  BH: ["#CE1126", "#8C0A20"], BD: ["#006A4E", "#F42A41"], BT: ["#FFD520", "#FF4E12"],
  BN: ["#F7E017", "#CF1126"], KH: ["#032EA1", "#E00025"], CN: ["#DE2910", "#FFDE00"],
  GE: ["#D0021B", "#A00115"], IN: ["#FF9933", "#138808"], ID: ["#CE1126", "#8C0A20"],
  IR: ["#239F40", "#DA0000"], IQ: ["#CE1126", "#007A3D"], IL: ["#0038B8", "#002D91"],
  JP: ["#BC002D", "#8E0022"], JO: ["#007A3D", "#CE1126"], KZ: ["#00AFCA", "#FEC50C"],
  KW: ["#007A3D", "#CE1126"], KG: ["#E8112D", "#FFEF00"], LA: ["#002868", "#CE1126"],
  LB: ["#ED1C24", "#00A651"], MY: ["#010066", "#CC0001"], MV: ["#D21034", "#007E3A"],
  MN: ["#C4272F", "#015197"], MM: ["#FECB00", "#34B233"], NP: ["#DC143C", "#003893"],
  KP: ["#024FA2", "#ED1C27"], OM: ["#C8102E", "#008000"], PK: ["#01411C", "#012B12"],
  PS: ["#007A3D", "#CE1126"], PH: ["#0038A8", "#CE1126"], QA: ["#8A1538", "#5E0E26"],
  SA: ["#006C35", "#00522A"], SG: ["#ED2939", "#B01F2B"], KR: ["#003478", "#CD2E3A"],
  LK: ["#8D2029", "#FFB700"], SY: ["#007A3D", "#CE1126"], TW: ["#000095", "#FE0000"],
  TJ: ["#006600", "#CC0000"], TH: ["#2D2A4A", "#A51931"], TL: ["#DC241F", "#FFC726"],
  TR: ["#E30A17", "#B00812"], TM: ["#28AE66", "#1F8B50"], AE: ["#00732F", "#FF0000"],
  UZ: ["#0099B5", "#1EB53A"], VN: ["#DA251D", "#FFFF00"], YE: ["#CE1126", "#000000"],
  AU: ["#00008B", "#E4002B"], FJ: ["#68BFE5", "#4A93B5"], KI: ["#CE1126", "#003F87"],
  MH: ["#003893", "#DD7500"], FM: ["#75B2DD", "#5A8FB5"], NR: ["#002B7F", "#FFC61E"],
  NZ: ["#00247D", "#CC142B"], PW: ["#4AADD6", "#FFDE00"], PG: ["#CE1126", "#000000"],
  WS: ["#CE1126", "#002B7F"], SB: ["#215B33", "#0051BA"], TO: ["#C10000", "#8E0000"],
  TV: ["#5B97B1", "#417A90"], VU: ["#009543", "#D21034"],
};

const MIN_CHROMA = 0.12;
const MIN_LIGHT = 0.12;
const MAX_LIGHT = 0.94;

/** The flag colour's hue, or null when it has none to give — black, white and
 * every grey read as unvisited land, not a country. */
function hueOf(hex: string): number | null {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const chroma = max - min;
  if (chroma < MIN_CHROMA || light < MIN_LIGHT || light > MAX_LIGHT) return null;
  const h =
    max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return (((h * 60) % 360) + 360) % 360;
}

/**
 * One fixed lightness band, unlike the retired table's five tones — decision
 * 1 asks for the flag hue "normalised to one lightness band", relying on the
 * real adjacency graph below (rather than a second, tone channel) to keep
 * neighbours apart. `FILL_SATURATION`/`FILL_LIGHTNESS` are chosen for
 * contrast against `--map-land`/`--map-ice`, checked below in both light and
 * dark (see `contrastReport`).
 */
const FILL_SATURATION = 58;
const FILL_LIGHTNESS = 46;

function toFill(hue: number): string {
  const s = FILL_SATURATION / 100;
  const l = FILL_LIGHTNESS / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Degrees between two hues the short way round: 350° and 10° are 20° apart. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** A country with no flag entry, or an achromatic one — a deterministic hue
 * from its own code, spread round the wheel, so it still gets a colour
 * rather than the fallback everywhere (a repeated fallback hue would itself
 * become "the colour of countries nobody drew a flag for"). */
function hashHue(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 131 + code.charCodeAt(i)) % 3600;
  return h / 10;
}

/** Relative luminance (WCAG) of a hex colour. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = chan((n >> 16) & 255);
  const g = chan((n >> 8) & 255);
  const b = chan(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a) + 0.05;
  const lb = luminance(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

async function main() {
  const res = await fetch(BORDERS_URL);
  if (!res.ok) throw new Error(`mledoze/countries fetch failed: ${res.status}`);
  const rows = (await res.json()) as { cca2: string; cca3: string; borders: string[] }[];
  const cca3ToCca2 = new Map(rows.map((r) => [r.cca3, r.cca2] as const));

  const codes = worldCountries
    .map((c) => c.code)
    .filter((c): c is string => Boolean(c))
    .sort(); // Deterministic, and stable under insertion — adding a country
  // later never reorders one already in the table (test/country-colours.test.ts).

  const adjacency: Record<string, string[]> = {};
  for (const code of codes) {
    const row = rows.find((r) => r.cca2 === code);
    const neighbours = (row?.borders ?? [])
      .map((b) => cca3ToCca2.get(b))
      .filter((c): c is string => c !== undefined && codes.includes(c));
    adjacency[code] = [...new Set(neighbours)].sort();
  }

  const assigned = new Map<string, number>(); // code -> hue
  for (const code of codes) {
    const pair = FLAG_COLOURS[code];
    const candidates = [
      ...(pair?.map(hueOf).filter((h): h is number => h !== null) ?? []),
      hashHue(code),
    ];
    const neighbourHues = adjacency[code].map((n) => assigned.get(n)).filter((h): h is number => h !== undefined);

    const clear = (hue: number) => neighbourHues.every((h) => hueGap(h, hue) >= 24);

    let chosen = candidates.find(clear);
    if (chosen === undefined) {
      // Every candidate collides with an already-coloured neighbour (only
      // possible with 4+ mutually adjacent neighbours already assigned, or a
      // small hashHue wheel colliding) — step the preferred hue round the
      // wheel until it clears, capped so this always terminates.
      const base = candidates[0];
      for (let step = 1; step <= 18 && chosen === undefined; step++) {
        for (const dir of [1, -1]) {
          const h = ((base + dir * step * 20) % 360 + 360) % 360;
          if (clear(h)) {
            chosen = h;
            break;
          }
        }
      }
    }
    // Never actually reached at 177 countries and a 24° gap over a real
    // planar graph (at most a handful of mutual neighbours anywhere), but a
    // repeat is still a smaller failure than an unset colour.
    chosen ??= candidates[0];
    assigned.set(code, chosen);
  }

  const colours: Record<string, string> = {};
  for (const [code, hue] of assigned) colours[code] = toFill(hue);

  fs.writeFileSync(COLOURS_FILE, JSON.stringify(colours));
  fs.writeFileSync(ADJACENCY_FILE, JSON.stringify(adjacency));

  // Contrast report — decision asks it be "checked", not enforced to a
  // WCAG number, since the border stays the guaranteed second channel
  // (decision 1's "borders stay as a second channel"). Printed for the
  // ticket, not stored per-country.
  const land = { light: "#f7f0de", dark: "#1b2635" };
  const ice = { light: "#ffffff", dark: "#2a3a52" };
  let minLightLand = Infinity, minDarkLand = Infinity, minLightIce = Infinity, minDarkIce = Infinity;
  for (const hex of Object.values(colours)) {
    minLightLand = Math.min(minLightLand, contrastRatio(hex, land.light));
    minDarkLand = Math.min(minDarkLand, contrastRatio(hex, land.dark));
    minLightIce = Math.min(minLightIce, contrastRatio(hex, ice.light));
    minDarkIce = Math.min(minDarkIce, contrastRatio(hex, ice.dark));
  }

  let collisions = 0;
  for (const [code, neighbours] of Object.entries(adjacency)) {
    for (const n of neighbours) if (colours[code] === colours[n]) collisions++;
  }

  console.log(`Wrote ${codes.length} country colours to ${path.relative(ROOT, COLOURS_FILE)}`);
  console.log(`Wrote adjacency for ${codes.length} countries to ${path.relative(ROOT, ADJACENCY_FILE)}`);
  console.log(
    `Min contrast — land: ${minLightLand.toFixed(2)}:1 light / ${minDarkLand.toFixed(2)}:1 dark, ` +
      `ice: ${minLightIce.toFixed(2)}:1 light / ${minDarkIce.toFixed(2)}:1 dark`,
  );
  console.log(`Neighbour colour collisions (borders are the second channel regardless): ${collisions}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
