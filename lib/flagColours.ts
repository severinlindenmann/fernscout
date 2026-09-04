/**
 * A country's flag, reduced to two colours — B370, retuned by B375.
 *
 * The lifetime map fills each visited country in its own flag's colour, so a
 * reader recognises Japan or Italy without reading a word.
 *
 * **Only the hue survives.** Every fill is normalised to one saturation and
 * lightness (`toFill` below), because the first attempt shipped the flags' own
 * values and the map became scattered ink: deep navy and near-black on pale
 * green land, with six European countries — France, Czechia, Estonia, Finland,
 * Sweden and the United States — arriving as six different hex strings and one
 * colour to the eye. Italy is still green and Japan still red; they simply sit
 * in the same tonal band as everything else, which is what lets a country the
 * size of Belgium read at all.
 *
 * Two colours per flag because hue is now the only channel carrying identity,
 * and flags share hues: the alternate is what a country falls back to when its
 * neighbour got there first.
 *
 * **Black and white are both refused.** A white country is a hole in the map —
 * the land beneath is pale green and the fill would read as unvisited — and a
 * black one reads as a rendering fault. Neither has a usable hue anyway, so
 * `toFill` rejects them and the flag's coloured band is used instead. That is
 * why Germany is red rather than black, and Japan red rather than white.
 *
 * Colours are the flag's own where a specification gives one. They are
 * decoration, not a source of truth about anybody's flag.
 */

/** ISO 3166-1 alpha-2 → [preferred, alternate]. */
export const FLAG_COLOURS: Record<string, [string, string]> = {
  // Europe
  AL: ["#E41E20", "#000000"],
  AD: ["#10069F", "#D0103A"],
  AT: ["#C8102E", "#7A0C1F"],
  BY: ["#C8102E", "#4AA657"],
  BE: ["#FDDA24", "#C8102E"],
  BA: ["#002395", "#FDDA24"],
  BG: ["#00966E", "#D62612"],
  HR: ["#171796", "#C8102E"],
  CY: ["#D57800", "#4E5B31"],
  CZ: ["#11457E", "#D7141A"],
  DK: ["#C8102E", "#8C0A20"],
  EE: ["#0072CE", "#111111"],
  FI: ["#003580", "#0057B7"],
  FR: ["#0055A4", "#EF4135"],
  DE: ["#111111", "#DD0000"],
  GR: ["#0D5EAF", "#08427A"],
  HU: ["#477050", "#CE2939"],
  IS: ["#02529C", "#DC1E35"],
  IE: ["#169B62", "#FF883E"],
  IT: ["#008C45", "#CD212A"],
  XK: ["#244AA5", "#D0A650"],
  LV: ["#9E3039", "#6E2028"],
  LI: ["#002B7F", "#CE1126"],
  LT: ["#FDB913", "#006A44"],
  LU: ["#00A1DE", "#ED2939"],
  MT: ["#CF142B", "#8C0A20"],
  MD: ["#0046AE", "#CC092F"],
  MC: ["#CE1126", "#8C0A20"],
  ME: ["#C40308", "#D4AF37"],
  NL: ["#AE1C28", "#21468B"],
  MK: ["#D20000", "#FFE600"],
  NO: ["#BA0C2F", "#00205B"],
  PL: ["#DC143C", "#9E0E2B"],
  PT: ["#046A38", "#DA291C"],
  RO: ["#FCD116", "#002B7F"],
  RU: ["#0039A6", "#D52B1E"],
  SM: ["#5EB6E4", "#3E8FB8"],
  RS: ["#C6363C", "#0C4076"],
  SK: ["#0B4EA2", "#EE1C25"],
  SI: ["#005DA4", "#ED1C24"],
  ES: ["#C60B1E", "#FFC400"],
  SE: ["#006AA7", "#FECC00"],
  CH: ["#DA291C", "#A81E14"],
  UA: ["#0057B7", "#FFD700"],
  GB: ["#012169", "#C8102E"],
  VA: ["#FFE000", "#B8A100"],

  // The Americas
  AR: ["#74ACDF", "#F6B40E"],
  BS: ["#00778B", "#FFC72C"],
  BB: ["#00267F", "#FFC726"],
  BZ: ["#003F87", "#CE1126"],
  BO: ["#D52B1E", "#007934"],
  BR: ["#009C3B", "#FFDF00"],
  CA: ["#D80621", "#A00518"],
  CL: ["#0039A6", "#D52B1E"],
  CO: ["#FCD116", "#003893"],
  CR: ["#002B7F", "#CE1126"],
  CU: ["#002A8F", "#CF142B"],
  DO: ["#002D62", "#CE1126"],
  EC: ["#FFDD00", "#034EA2"],
  SV: ["#0F47AF", "#0B3585"],
  GT: ["#4997D0", "#3A7BAC"],
  GY: ["#009E49", "#FCD116"],
  HT: ["#00209F", "#D21034"],
  HN: ["#0073CF", "#005AA3"],
  JM: ["#009B3A", "#FED100"],
  MX: ["#006847", "#CE1126"],
  NI: ["#0067C6", "#0050A0"],
  PA: ["#005293", "#DA121A"],
  PY: ["#D52B1E", "#0038A8"],
  PE: ["#D91023", "#A80D1B"],
  PR: ["#0050F0", "#ED0000"],
  SR: ["#377E3F", "#B40A2D"],
  TT: ["#DA1A35", "#000000"],
  US: ["#3C3B6E", "#B22234"],
  UY: ["#0038A8", "#FCD116"],
  VE: ["#FFCC00", "#00247D"],

  // Africa
  DZ: ["#006233", "#D21034"],
  AO: ["#CE1126", "#000000"],
  BJ: ["#008751", "#FCD116"],
  BW: ["#75AADB", "#000000"],
  BF: ["#EF2B2D", "#009E49"],
  BI: ["#CE1126", "#1EB53A"],
  CM: ["#007A5E", "#CE1126"],
  CV: ["#003893", "#CF2027"],
  CF: ["#003082", "#289728"],
  TD: ["#002664", "#C60C30"],
  KM: ["#3A75C4", "#3D8E33"],
  CD: ["#007FFF", "#F7D618"],
  CG: ["#009543", "#FBDE4A"],
  CI: ["#F77F00", "#009E60"],
  DJ: ["#6AB2E7", "#12AD2B"],
  EG: ["#C09300", "#CE1126"],
  GQ: ["#3E9A00", "#0073CE"],
  ER: ["#4189DD", "#EA0437"],
  ET: ["#078930", "#FCDD09"],
  GA: ["#009E60", "#FCD116"],
  GM: ["#CE1126", "#0C1C8C"],
  GH: ["#006B3F", "#FCD116"],
  GN: ["#CE1126", "#009460"],
  GW: ["#CE1126", "#FCD116"],
  KE: ["#006600", "#BB0000"],
  LS: ["#00209F", "#009543"],
  LR: ["#002868", "#BF0A30"],
  LY: ["#239E46", "#E70013"],
  MG: ["#007E3A", "#FC3D32"],
  MW: ["#21873B", "#CE1126"],
  ML: ["#14B53A", "#FCD116"],
  MR: ["#006233", "#FFC400"],
  MU: ["#EA2839", "#1A206D"],
  MA: ["#C1272D", "#006233"],
  MZ: ["#007168", "#FCE100"],
  NA: ["#003580", "#009543"],
  NE: ["#0DB02B", "#E05206"],
  NG: ["#008751", "#00603A"],
  RW: ["#20603D", "#00A1DE"],
  ST: ["#12AD2B", "#FFCE00"],
  SN: ["#00853F", "#FDEF42"],
  SC: ["#003F87", "#D62828"],
  SL: ["#1EB53A", "#0072C6"],
  SO: ["#4189DD", "#3172B8"],
  ZA: ["#007A4D", "#DE3831"],
  SS: ["#078930", "#0F47AF"],
  SD: ["#007229", "#D21034"],
  SZ: ["#3E5EB9", "#B10C0C"],
  TZ: ["#1EB53A", "#00A3DD"],
  TG: ["#006A4E", "#FFCE00"],
  TN: ["#E70013", "#B8000F"],
  UG: ["#FCDC04", "#D90000"],
  EH: ["#007A3D", "#C4111B"],
  ZM: ["#198A00", "#EF7D00"],
  ZW: ["#319208", "#FFD200"],

  // Asia and the Middle East
  AF: ["#007A36", "#D32011"],
  AM: ["#0033A0", "#D90012"],
  AZ: ["#00B5E2", "#EF3340"],
  BH: ["#CE1126", "#8C0A20"],
  BD: ["#006A4E", "#F42A41"],
  BT: ["#FFD520", "#FF4E12"],
  BN: ["#F7E017", "#CF1126"],
  KH: ["#032EA1", "#E00025"],
  CN: ["#DE2910", "#FFDE00"],
  GE: ["#D0021B", "#A00115"],
  IN: ["#FF9933", "#138808"],
  ID: ["#CE1126", "#8C0A20"],
  IR: ["#239F40", "#DA0000"],
  IQ: ["#CE1126", "#007A3D"],
  IL: ["#0038B8", "#002D91"],
  JP: ["#BC002D", "#8E0022"],
  JO: ["#007A3D", "#CE1126"],
  KZ: ["#00AFCA", "#FEC50C"],
  KW: ["#007A3D", "#CE1126"],
  KG: ["#E8112D", "#FFEF00"],
  LA: ["#002868", "#CE1126"],
  LB: ["#ED1C24", "#00A651"],
  MY: ["#010066", "#CC0001"],
  MV: ["#D21034", "#007E3A"],
  MN: ["#C4272F", "#015197"],
  MM: ["#FECB00", "#34B233"],
  NP: ["#DC143C", "#003893"],
  KP: ["#024FA2", "#ED1C27"],
  OM: ["#C8102E", "#008000"],
  PK: ["#01411C", "#012B12"],
  PS: ["#007A3D", "#CE1126"],
  PH: ["#0038A8", "#CE1126"],
  QA: ["#8A1538", "#5E0E26"],
  SA: ["#006C35", "#00522A"],
  SG: ["#ED2939", "#B01F2B"],
  KR: ["#003478", "#CD2E3A"],
  LK: ["#8D2029", "#FFB700"],
  SY: ["#007A3D", "#CE1126"],
  TW: ["#000095", "#FE0000"],
  TJ: ["#006600", "#CC0000"],
  TH: ["#2D2A4A", "#A51931"],
  TL: ["#DC241F", "#FFC726"],
  TR: ["#E30A17", "#B00812"],
  TM: ["#28AE66", "#1F8B50"],
  AE: ["#00732F", "#FF0000"],
  UZ: ["#0099B5", "#1EB53A"],
  VN: ["#DA251D", "#FFFF00"],
  YE: ["#CE1126", "#000000"],

  // Oceania
  AU: ["#00008B", "#E4002B"],
  FJ: ["#68BFE5", "#4A93B5"],
  KI: ["#CE1126", "#003F87"],
  MH: ["#003893", "#DD7500"],
  FM: ["#75B2DD", "#5A8FB5"],
  NR: ["#002B7F", "#FFC61E"],
  NZ: ["#00247D", "#CC142B"],
  PW: ["#4AADD6", "#FFDE00"],
  PG: ["#CE1126", "#000000"],
  WS: ["#CE1126", "#002B7F"],
  SB: ["#215B33", "#0051BA"],
  TO: ["#C10000", "#8E0000"],
  TV: ["#5B97B1", "#417A90"],
  VU: ["#009543", "#D21034"],
};

/**
 * The tonal band every fill is forced into.
 *
 * Chosen against what the map actually is: pale green land (`#dff3e0`) and a
 * blue sea. Saturated enough to be obviously deliberate, light enough that a
 * country is a colour rather than a blot, and dark enough to hold an outline.
 */
const FILL_SATURATION = 62;

/**
 * Three tones, and why a second channel is needed at all.
 *
 * Hue alone cannot separate a well-travelled journal: 23 countries on a 360°
 * wheel is 15° each, below what anybody can tell apart on a shape the size of
 * Belgium — and forcing them apart by rotating hue is worse than the problem.
 * Tried, and it turned Czechia red, Sweden yellow and Italy teal; a country
 * that is not its flag's colour has lost the only thing this encoding was for.
 *
 * So hue stays faithful to the flag, always, and countries that share one are
 * separated by tone instead. Mid first, so a journal of a few countries uses
 * one consistent weight and only a crowded one reaches for the others.
 */
const FILL_LIGHTNESS = [55, 40, 70, 47, 63] as const;

/**
 * How far apart two fills must be on the colour wheel, in degrees.
 *
 * The whole point of B375: the previous check compared hex strings, so six
 * near-identical blues passed it. 24° is about the smallest difference that
 * survives being painted on a country the size of Belgium.
 */
const MIN_HUE_GAP = 24;

/** Below this saturation a colour has no hue worth keeping — black, white and
 * every grey. Above/below these lightnesses likewise. */
const MIN_CHROMA = 0.12;
const MIN_LIGHT = 0.12;
const MAX_LIGHT = 0.94;

/** The flag colour's hue, or null when it has none to give. */
function hueOf(hex: string): number | null {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const chroma = max - min;

  // Black, white and grey have no hue — and neither belongs on this map.
  if (chroma < MIN_CHROMA || light < MIN_LIGHT || light > MAX_LIGHT) return null;

  const h =
    max === r
      ? ((g - b) / chroma) % 6
      : max === g
        ? (b - r) / chroma + 2
        : (r - g) / chroma + 4;
  return ((h * 60) % 360 + 360) % 360;
}

/** A hue, at one of the shared tones. */
function toFill(hue: number, lightness: number): string {
  const s = FILL_SATURATION / 100;
  const l = lightness / 100;
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
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Degrees between two hues the short way round: 350° and 10° are 20° apart. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * When a country has no entry above. Brand coral, the fill B361 used for
 * everything — a country nobody has a colour for is still visited, and must
 * not read as unvisited land.
 */
export const FLAG_FALLBACK = "#c2334a";

/**
 * One colour per country: its flag's hue, and a tone that keeps it apart from
 * its neighbours.
 *
 * Greedy and order-dependent, so the caller passes a stable order — the same
 * journal has to colour the same way on every render, and iterating a `Map`
 * built from disk reads is not a promise of that.
 *
 * A country offers its flag's two hues and takes the first whose (hue, tone)
 * is not already spoken for; failing that it keeps its own hue and steps down
 * the tones. **The hue is never rotated** — see `FILL_LIGHTNESS`. Where even
 * that runs out, a repeat ships: two countries the same colour is a legend
 * lookup, where a country in the wrong colour is a lie.
 *
 * B375. The first version compared hex strings, which is how France, Czechia,
 * Estonia, Finland, Sweden and the United States passed a collision test as
 * six distinct values and arrived on the map as one blue.
 */
export function assignFlagColours(codes: readonly string[]): Map<string, string> {
  const taken: { hue: number; tone: number }[] = [];
  const out = new Map<string, string>();

  const clear = (hue: number, tone: number) =>
    taken.every((t) => t.tone !== tone || hueGap(t.hue, hue) >= MIN_HUE_GAP);

  for (const code of codes) {
    const pair = FLAG_COLOURS[code];
    if (!pair) {
      out.set(code, FLAG_FALLBACK);
      continue;
    }

    // Achromatic candidates drop out here: a black or white flag has no hue,
    // and neither colour may be painted on this map.
    const hues = pair.map(hueOf).filter((h): h is number => h !== null);
    if (hues.length === 0) {
      out.set(code, FLAG_FALLBACK);
      continue;
    }

    let chosen: { hue: number; tone: number } | undefined;
    for (const tone of FILL_LIGHTNESS) {
      const hue = hues.find((h) => clear(h, tone));
      if (hue !== undefined) {
        chosen = { hue, tone };
        break;
      }
    }
    // Every slot spoken for. Rather than take the flag's hue at the default
    // tone — which is how France arrived as an exact copy of Czechia — pick
    // the combination that sits furthest from everything already used. Still a
    // near-duplicate on a crowded map, but the least bad one available.
    if (!chosen) {
      let best: { hue: number; tone: number; room: number } = {
        hue: hues[0],
        tone: FILL_LIGHTNESS[0],
        room: -1,
      };
      for (const tone of FILL_LIGHTNESS) {
        for (const hue of hues) {
          const room = Math.min(
            ...taken
              .filter((t) => t.tone === tone)
              .map((t) => hueGap(t.hue, hue)),
            360,
          );
          if (room > best.room) best = { hue, tone, room };
        }
      }
      chosen = { hue: best.hue, tone: best.tone };
    }

    taken.push(chosen);
    out.set(code, toFill(chosen.hue, chosen.tone));
  }

  return out;
}
