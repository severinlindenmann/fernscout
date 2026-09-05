/**
 * The words a traveller is described in.
 *
 * Named tokens rather than raw hex, so an author picks rather than mixes —
 * and so an agent asking "how would you like to be drawn?" has something to
 * offer that is not a colour picker. Hex stays legal everywhere a token is
 * (see `colour` below), because a person describing their own hair should be
 * able to be exact about it.
 *
 * Nothing here is a claim about anybody. A tone is a tone; the file records
 * `skin: deep`, never where somebody is from. See `presets.ts` for why the
 * starting points that *are* named for regions never reach disk.
 */

/**
 * Ordinal and descriptive, on purpose. Food metaphors and numbered "types"
 * were both considered and both read as a catalogue of people rather than a
 * palette; these say only how light or deep a tone is, which is the single
 * thing the renderer needs.
 */
export const SKIN = {
  "light": "#f8ddc4",
  "light-medium": "#eec39a",
  "medium": "#d9a273",
  "medium-deep": "#b77b4d",
  "deep": "#8b5630",
  "rich": "#5e3720",
} as const;

/**
 * Grey and white are colours like any other here, and nothing greys on its
 * own with `age`. A person with an unchanged head of black hair at seventy
 * should not have to fight the renderer to keep it.
 */
export const HAIR = {
  "black": "#1c1a1a",
  "dark-brown": "#3b2a1c",
  "brown": "#6b4423",
  "auburn": "#8c3a1e",
  "red": "#c0562a",
  "blond": "#d9a441",
  "grey": "#9aa3ad",
  "white": "#e8e4de",
} as const;

/**
 * Two circles of r=2 in a 64-wide viewBox. Nearly invisible in the hero and
 * legible in the preview and the photobook, which is why it is here at all —
 * and why `describe-a-traveller` does not spend one of its questions on it.
 */
export const EYES = {
  "brown": "#6b4423",
  "dark-brown": "#3b2a1c",
  "hazel": "#8a6b2f",
  "green": "#4a7c50",
  "blue": "#3f7fa8",
  "grey": "#7d8a95",
} as const;

/** Clothing, packs and the headscarf. The journal's own palette, plus room. */
export const CLOTH = {
  "sky": "#3fa9c4",
  "coral": "#f06a8a",
  "yellow": "#f0bd2e",
  "green": "#3aa76d",
  "blue": "#2f6fed",
  "slate": "#37475f",
  "plum": "#7d5ba6",
  "sand": "#cfa878",
  "teal": "#159a9a",
  "rust": "#c2653a",
  "cream": "#f3e6cd",
} as const;

export const HAIR_STYLES = [
  "buzz",
  "short",
  "tousled",
  "long",
  "curly",
  "coils",
  "braids",
  "bun",
  "ponytail",
  "bald",
  /**
   * A style rather than an accessory, because it *replaces* the hair instead
   * of resting on it. As an accessory the two would both want layer 8 and one
   * would win by accident.
   */
  "headscarf",
] as const;

export const ACCESSORIES = [
  "glasses",
  "sunglasses",
  "hat",
  "cap",
  "beanie",
  "scarf",
  "camera",
  "stick",
] as const;

/**
 * What they are wearing below the shoulders.
 *
 * Everybody used to be drawn in trousers — two rounded rects in `pants` were
 * the only garment there was — so a person who wears a dress, a skirt or a
 * robe could not be drawn as themselves at all (B498).
 *
 * **Which colour a garment takes follows one rule**: whatever covers the
 * torso takes `shirt`, and a separate lower garment takes `pants`. So a
 * `dress` and a `robe` are `shirt`-coloured (they *are* the top), while
 * `trousers`, `shorts` and a `skirt` are `pants`-coloured under a `shirt`.
 * Worth stating because it is the one thing a person gets wrong when writing
 * the block by hand.
 */
export const OUTFITS = ["trousers", "shorts", "skirt", "dress", "robe"] as const;

export const BUILDS = ["slight", "average", "broad"] as const;
export const AGES = ["child", "teen", "adult", "elder"] as const;

export type SkinTone = keyof typeof SKIN;
export type HairColour = keyof typeof HAIR;
export type EyeColour = keyof typeof EYES;
export type ClothColour = keyof typeof CLOTH;
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type Outfit = (typeof OUTFITS)[number];
export type Build = (typeof BUILDS)[number];
export type Age = (typeof AGES)[number];

/**
 * One traveller, as the file records them.
 *
 * Every field is optional and every absent field means the neutral default —
 * which is the shape the agent interview needs. Somebody who says "short dark
 * hair" and stops has answered two of these, and the other nine must read as
 * *unanswered* rather than as chosen, so the agent can say so.
 */
export type Figure = {
  /**
   * An address in the trip's `people:`, tying a figure to a name. Optional: a
   * party may have figures nobody is named for, and people nobody drew.
   */
  for?: string;
  skin?: SkinTone | string;
  hair?: HairColour | string;
  hairStyle?: HairStyle;
  eyes?: EyeColour | string;
  shirt?: ClothColour | string;
  pants?: ClothColour | string;
  /** `"none"` draws no pack at all. */
  pack?: ClothColour | "none" | string;
  /** What they wear below the shoulders. See `OUTFITS` for the colour rule. */
  outfit?: Outfit;
  /** The colour of a `headscarf`; ignored for every other style. */
  headscarf?: ClothColour | string;
  build?: Build;
  age?: Age;
  accessories?: Accessory[];
};

/**
 * Age is a height multiplier and **nothing else automatic**. It is what makes
 * a family with children at a smaller scale work, and it is deliberately the
 * only thing age does — see `HAIR` above.
 */
export const AGE_SCALE: Record<Age, number> = {
  child: 0.7,
  teen: 0.87,
  adult: 1,
  elder: 0.95,
};

/** The silhouette, applied as a horizontal scale about the figure's centre. */
export const BUILD_SCALE: Record<Build, number> = {
  slight: 0.9,
  average: 1,
  broad: 1.13,
};

/**
 * Matches `MAX_TRIP_PEOPLE`, and for the same reason: past ten it is a crowd
 * scene rather than a party, and it does not fit a hero on a phone.
 */
export const MAX_FIGURES = 10;

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A token, a hex code, or the fallback — in that order.
 *
 * Fails **open** at every level. This is cosmetic data and the reader has
 * nobody to tell, so an unrecognised word draws the default rather than
 * dropping the figure. The place that refuses instead is the write path,
 * where somebody is listening: see `travellersBlock` in lib/tripWrite.ts.
 */
export function colour(
  value: string | undefined,
  map: Record<string, string>,
  fallback: string,
): string {
  if (typeof value === "string") {
    if (HEX_RE.test(value)) return value;
    // `Object.hasOwn`, not `map[value]`. A plain `in`/index lookup finds
    // Object.prototype: `hair: "constructor"` resolves to the Object
    // constructor and `String()`s into the SVG as
    // `fill="function Object() { [native code] }"`. It happens to carry no
    // quote so it cannot break out of the attribute, but the value reaching
    // the output at all is the bug — and the next table added here might not
    // be so lucky.
    if (Object.hasOwn(map, value)) return map[value];
  }
  return Object.hasOwn(map, fallback) ? map[fallback] : fallback;
}

/** A hex colour multiplied toward black, for the shirt yoke and hair parts. */
export function shade(hex: string, factor: number): string {
  const full =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = Number.parseInt(full.slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(c * factor))),
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
