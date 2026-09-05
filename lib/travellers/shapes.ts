import {
  BUILD_SCALE,
  CLOTH,
  EYES,
  HAIR,
  SKIN,
  colour,
  shade,
  type Figure,
  type HairStyle,
} from "./vocabulary";

/**
 * What a traveller looks like, as geometry rather than as markup.
 *
 * **The only description of the figure in this repository.** It used to be two:
 * `render.ts` drew SVG for the website and `lib/photobook/travellers.ts` drew
 * PDF operators for the printed book, with the palette and the path data
 * copied across by hand and a comment admitting it. The two were "unlikely to
 * drift" right up until B11 gave the website eleven hair styles and B498 gave
 * it five outfits, at which point the book was printing one particular couple
 * in trousers on the title page of everybody's journey (B497).
 *
 * So the shapes live here, in the component's own 64×96 coordinate space with
 * y increasing **downwards**, and each consumer serialises them:
 *
 * - `render.ts` → SVG, for the site, the preview endpoint and the sheet
 * - `lib/photobook/travellers.ts` → PDF operators, flipping y on the way
 *
 * A shape nobody can express in both is a shape that does not belong here.
 */

/** A fill or stroke: a hex colour, or `"shadow"` for the ground shadow, which
 *  each serialiser resolves its own way — a CSS variable on the web, a flat
 *  grey on paper, where there is no alpha to have. */
export type Paint = string;

export type Shape =
  | { kind: "path"; d: string; fill?: Paint; stroke?: Paint; width?: number; opacity?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: Paint; stroke?: Paint; width?: number; opacity?: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill?: Paint; stroke?: Paint; width?: number; opacity?: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; r?: number; fill: Paint; opacity?: number }
  /** A horizontal scale about `aboutX` — the `build` silhouette. Its own kind
   *  rather than baked into coordinates because the paths inside it are `d`
   *  strings, and scaling those would mean parsing them here. */
  | { kind: "group"; scaleX: number; aboutX: number; shapes: Shape[] };

/** The ground shadow's paint. Resolved per serialiser; see `Paint`. */
export const SHADOW: Paint = "shadow";

const K = 0.5522847498307936;

/** A ring of overlapping circles around the skull, for curls and coils. */
function clump(fill: string, r: number, radius: number, from: number, to: number, n: number): Shape[] {
  const out: Shape[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((from + ((to - from) * i) / (n - 1)) * Math.PI) / 180;
    out.push({
      kind: "circle",
      cx: 32 + Math.cos(a) * radius,
      cy: 24 - Math.sin(a) * radius,
      r,
      fill,
    });
  }
  return out;
}

/** Styles with a part drawn *behind* the body. */
export const BEHIND: ReadonlySet<string> = new Set([
  "long",
  "braids",
  "ponytail",
  "bun",
  "headscarf",
]);

function hairBehind(style: HairStyle, c: string): Shape[] {
  switch (style) {
    case "long":
      return [{ kind: "path", d: "M14 26q-3 26 2 38q16 5 32 0q5-12 2-38z", fill: c }];
    case "braids":
      return [
        { kind: "path", d: "M15 27q-2 13 0 21q17 4 34 0q2-8 0-21z", fill: c },
        { kind: "path", d: "M13.5 30q-4 18 0 30q4 2 7 0q2-16-1-30z", fill: c },
        { kind: "path", d: "M50.5 30q4 18 0 30q-4 2-7 0q-2-16 1-30z", fill: c },
        { kind: "ellipse", cx: 16.6, cy: 42, rx: 4.4, ry: 1.5, fill: shade(c, 0.78), opacity: 0.75 },
        { kind: "ellipse", cx: 16.4, cy: 50, rx: 4.2, ry: 1.5, fill: shade(c, 0.78), opacity: 0.75 },
        { kind: "ellipse", cx: 47.4, cy: 42, rx: 4.4, ry: 1.5, fill: shade(c, 0.78), opacity: 0.75 },
        { kind: "ellipse", cx: 47.6, cy: 50, rx: 4.2, ry: 1.5, fill: shade(c, 0.78), opacity: 0.75 },
      ];
    case "ponytail":
      return [
        { kind: "path", d: "M45 22q11 5 11 20q0 12-7 16q-5 1-4.5-4q6-6 5-16q-1-11-8-13z", fill: c },
      ];
    case "bun":
      return [
        { kind: "circle", cx: 45, cy: 10.5, r: 7.6, fill: c },
        { kind: "circle", cx: 45, cy: 10.5, r: 4, fill: shade(c, 0.82), opacity: 0.6 },
      ];
    case "headscarf":
      return [{ kind: "path", d: "M15 25q-4 22 1 33q16 5 32 0q5-11 1-33z", fill: c }];
    default:
      return [];
  }
}

function hairInFront(style: HairStyle, c: string): Shape[] {
  switch (style) {
    case "bald":
      return [{ kind: "ellipse", cx: 27, cy: 14, rx: 6, ry: 3, fill: "#ffffff", opacity: 0.18 }];
    case "buzz":
      return [{ kind: "path", d: "M17 23a15 15 0 0130 0q-5-6-15-6t-15 6z", fill: c, opacity: 0.92 }];
    case "short":
      return [
        { kind: "path", d: "M16.5 22a15.5 15.5 0 0131 0q-4-6-9-4q-6-4-13 0q-6-1-9 4z", fill: c },
      ];
    case "tousled":
      return [
        {
          kind: "path",
          d: "M16.5 22a15.5 15.5 0 0131 0q-3-7-8-4q-5-5-11-1q-4-3-8 1q-3-1-4 4z",
          fill: c,
        },
      ];
    case "curly":
      return [
        ...clump(c, 5.6, 15.5, 8, 172, 9),
        { kind: "path", d: "M17 24a15 15 0 0130 0q-6-8-15-8t-15 8z", fill: c },
      ];
    case "coils":
      return [
        ...clump(c, 3.7, 16.2, 4, 176, 13),
        ...clump(c, 3.5, 12.4, 22, 158, 8),
        { kind: "path", d: "M17.5 24a14.5 14.5 0 0129 0q-6-7-14.5-7t-14.5 7z", fill: c },
      ];
    case "braids":
      return [
        { kind: "path", d: "M16 23a16 16 0 0132 0q-5-8-16-8t-16 8z", fill: c },
        { kind: "path", d: "M31.2 8.4h1.6l0.6 6h-2.8z", fill: shade(c, 0.75) },
      ];
    case "bun":
    case "ponytail":
      return [{ kind: "path", d: "M16.5 23a15.5 15.5 0 0131 0q-6-7-15.5-7t-15.5 7z", fill: c }];
    case "headscarf":
      return [
        { kind: "path", d: "M15.6 26a16.4 16.4 0 0132.8 0q-1-13-16.4-13t-16.4 13z", fill: c },
        { kind: "path", d: "M15.8 25q-0.6 11 3 17q3-9 2-17z", fill: c },
        { kind: "path", d: "M48.2 25q0.6 11-3 17q-3-9-2-17z", fill: c },
        {
          kind: "path",
          d: "M15.6 26a16.4 16.4 0 0132.8 0q-2 2-3.4 1.4a14 14 0 00-26 0q-1.4 0.6-3.4-1.4z",
          fill: shade(c, 0.85),
          opacity: 0.7,
        },
      ];
    case "long":
    default:
      return [{ kind: "path", d: "M16 23a16 16 0 0132 0q-4-9-16-9t-16 9z", fill: c }];
  }
}

/**
 * Everything below the shoulders — B498.
 *
 * The colour rule: whatever covers the torso takes `shirt`, a separate lower
 * garment takes `pants`. So a dress and a robe swallow the torso and are
 * shirt-coloured; the other three keep it. Legs and feet come first in every
 * case, because a hem has to sit over the top of them.
 */
function lowerBody(outfit: string, shirt: string, pants: string, skin: string): Shape[] {
  const legs = (top: number, length: number, fill: string, inset = 0): Shape[] => [
    { kind: "rect", x: 21 + inset, y: top, w: 9.5 - inset * 2, h: length, r: 4.75 - inset, fill },
    { kind: "rect", x: 33.5 + inset, y: top, w: 9.5 - inset * 2, h: length, r: 4.75 - inset, fill },
  ];
  const feet: Shape[] = [
    { kind: "ellipse", cx: 25.5, cy: 89, rx: 6.5, ry: 3.2, fill: "#2b3648" },
    { kind: "ellipse", cx: 38.5, cy: 89, rx: 6.5, ry: 3.2, fill: "#2b3648" },
  ];
  const torso: Shape[] = [
    { kind: "path", d: "M17 42q15-6 30 0l2 24q-17 6-34 0z", fill: shirt },
    {
      kind: "path",
      d: "M17 42q15-6 30 0l0.6 7q-15-5-31 0z",
      fill: shade(shirt, 0.8),
      opacity: 0.6,
    },
  ];

  switch (outfit) {
    case "shorts":
      // The hem clears the torso before it stops, or the garment is hidden
      // under the shirt and all that reads is bare legs — which is any outfit.
      return [...legs(64, 24, skin, 0.55), ...feet, ...legs(64, 15, pants), ...torso];
    case "skirt":
      return [
        ...legs(64, 24, skin, 0.55),
        ...feet,
        { kind: "path", d: "M18.5 64q13.5-4 27 0l4 16q-17.5 5-35 0z", fill: pants },
        {
          kind: "path",
          d: "M18.5 64q13.5-4 27 0l0.5 3q-14-3.4-28 0z",
          fill: shade(pants, 0.82),
          opacity: 0.5,
        },
        ...torso,
      ];
    case "dress":
      return [
        ...legs(70, 18, skin, 0.55),
        ...feet,
        { kind: "path", d: "M17 42q15-6 30 0l7 34q-22 6-44 0z", fill: shirt },
        {
          kind: "path",
          d: "M17 42q15-6 30 0l0.6 7q-15-5-31 0z",
          fill: shade(shirt, 0.8),
          opacity: 0.6,
        },
      ];
    case "robe":
      return [
        ...feet,
        { kind: "path", d: "M17 42q15-6 30 0l6 46q-21 5-42 0z", fill: shirt },
        {
          kind: "path",
          d: "M17 42q15-6 30 0l0.6 7q-15-5-31 0z",
          fill: shade(shirt, 0.8),
          opacity: 0.6,
        },
        { kind: "path", d: "M31 50h2l1 38h-4z", fill: shade(shirt, 0.88), opacity: 0.55 },
      ];
    case "trousers":
    default:
      return [...legs(64, 24, pants), ...feet, ...torso];
  }
}

function accessory(name: string): Shape[] {
  switch (name) {
    case "glasses": {
      const wire = { stroke: "#33261c", width: 1.5, opacity: 0.9 } as const;
      return [
        { kind: "circle", cx: 25.5, cy: 25, r: 4.6, ...wire },
        { kind: "circle", cx: 38.5, cy: 25, r: 4.6, ...wire },
        { kind: "path", d: "M30.1 25h3.8", ...wire },
        { kind: "path", d: "M20.9 24.2 17 22.9", ...wire },
        { kind: "path", d: "M43.1 24.2 47 22.9", ...wire },
      ];
    }
    case "sunglasses":
      return [
        { kind: "rect", x: 20.4, y: 21.2, w: 10, h: 7.2, r: 3.2, fill: "#2b3648" },
        { kind: "rect", x: 33.6, y: 21.2, w: 10, h: 7.2, r: 3.2, fill: "#2b3648" },
        { kind: "rect", x: 30.4, y: 23.6, w: 3.2, h: 1.6, fill: "#2b3648" },
        { kind: "path", d: "M20.4 23.4 16.8 22.2l0.4-1.5 3.9 1.3z", fill: "#2b3648" },
        { kind: "path", d: "M43.6 23.4l3.6-1.2-0.4-1.5-3.9 1.3z", fill: "#2b3648" },
      ];
    case "hat":
      return [
        { kind: "ellipse", cx: 32, cy: 14.5, rx: 25, ry: 5.6, fill: "#e0c48b" },
        { kind: "ellipse", cx: 32, cy: 13.6, rx: 25, ry: 5.6, fill: "#eed9a8" },
        { kind: "path", d: "M20.5 14q0.6-12 11.5-12t11.5 12z", fill: "#eed9a8" },
        { kind: "path", d: "M20.6 12.6q11-3 22.8 0l0.2 1.6q-11.6-3-23.2 0z", fill: "#b98f4e" },
      ];
    case "cap":
      return [
        { kind: "path", d: "M18.5 14.6a13.5 13.5 0 0127 0z", fill: "#3fa9c4" },
        { kind: "path", d: "M18.5 14.6q-0.2-1.6 1-1.8 12-2 25 0 1.2 0.2 1 1.8z", fill: "#2f89a1" },
        { kind: "path", d: "M45.5 14.6q11 0.6 13.5 4-2.5 2.4-13.5 2.4z", fill: "#2f89a1" },
      ];
    case "beanie":
      return [
        { kind: "path", d: "M18.5 15a13.5 13.5 0 0127 0z", fill: "#c2653a" },
        { kind: "rect", x: 17.4, y: 13.4, w: 29.2, h: 5, r: 2.5, fill: "#a8532c" },
        { kind: "rect", x: 30.8, y: 1.6, w: 2.4, h: 6, fill: "#c2653a" },
        { kind: "circle", cx: 32, cy: 0.6, r: 3.6, fill: "#eed9a8" },
      ];
    case "scarf":
      return [
        {
          kind: "path",
          d: "M21.6 38.6q10.4 6.4 20.8 0 1.4 5.2-0.8 8-9.6 4.4-19.2 0-2.2-2.8-0.8-8z",
          fill: "#c2334a",
        },
        {
          kind: "path",
          d: "M25 45.4q3 1 5.6 1l-1.2 13.4q-2.6 0.6-4.6-0.4z",
          fill: "#c2334a",
          opacity: 0.92,
        },
      ];
    case "camera":
      return [
        { kind: "path", d: "M23 41.4 30 55.6", stroke: "#5e4632", width: 1.9 },
        { kind: "path", d: "M41 41.4 34 55.6", stroke: "#5e4632", width: 1.9 },
        { kind: "rect", x: 25.4, y: 53.6, w: 13.2, h: 9.4, r: 2.4, fill: "#2b3648" },
        { kind: "circle", cx: 32, cy: 58.3, r: 3.4, fill: "#8fe0ef" },
        { kind: "circle", cx: 32, cy: 58.3, r: 1.7, fill: "#1e293b" },
        { kind: "rect", x: 34.6, y: 55.4, w: 2.6, h: 1.8, r: 0.9, fill: "#ffd23f" },
      ];
    case "stick":
      return [
        { kind: "rect", x: 50.4, y: 36, w: 2.6, h: 52, r: 1.3, fill: "#9c7a4e" },
        { kind: "circle", cx: 51.7, cy: 35.4, r: 2.6, fill: "#7d6140" },
      ];
    default:
      return [];
  }
}

/** How much taller or shorter this figure is — `age`, and nothing else. */
export { AGE_SCALE } from "./vocabulary";

/**
 * One figure, in the 64×96 viewBox, y downwards.
 *
 * Painter's order throughout, which is the whole of the depth: shadow, hair
 * behind, pack, legs, feet, torso, arms, hands, head, hair in front, face,
 * accessories. There is no z-index in a PDF content stream, only what was
 * painted last, and the web side depends on the same ordering.
 */
export function figureShapes(figure: Figure, options: { head?: boolean } = {}): Shape[] {
  const skin = colour(figure.skin, SKIN, "medium");
  const hair = colour(figure.hair, HAIR, "dark-brown");
  const eyes = colour(figure.eyes, EYES, "brown");
  const shirt = colour(figure.shirt, CLOTH, "sky");
  const pants = colour(figure.pants, CLOTH, "slate");
  const pack = figure.pack === "none" ? null : colour(figure.pack, CLOTH, "yellow");
  const style: HairStyle = figure.hairStyle ?? "short";

  // A headscarf drawn in the hair colour just reads as long hair. It is
  // fabric, so it takes a cloth colour, defaulting to the shirt because that
  // is always distinct from both skin and hair.
  const crown =
    style === "headscarf"
      ? figure.headscarf
        ? colour(figure.headscarf, CLOTH, "sky")
        : shirt
      : hair;

  const build = BUILD_SCALE[figure.build ?? "average"];
  const head = options.head === true;

  const body: Shape[] = [
    ...(pack
      ? ([
          { kind: "rect", x: 6, y: 40, w: 15, h: 21, r: 6, fill: pack },
          { kind: "rect", x: 9, y: 46, w: 9, h: 3, r: 1.5, fill: "#000000", opacity: 0.14 },
        ] as Shape[])
      : []),
    {
      kind: "group",
      scaleX: build,
      aboutX: 32,
      shapes: [
        ...lowerBody(figure.outfit ?? "trousers", shirt, pants, skin),
        { kind: "rect", x: 11.5, y: 44, w: 8, h: 22, r: 4, fill: shirt },
        { kind: "rect", x: 44.5, y: 44, w: 8, h: 22, r: 4, fill: shirt },
        { kind: "circle", cx: 15.5, cy: 67, r: 4.6, fill: skin },
        { kind: "circle", cx: 48.5, cy: 67, r: 4.6, fill: skin },
      ],
    },
  ];

  return [
    ...(head
      ? []
      : ([{ kind: "ellipse", cx: 32, cy: 92, rx: 17 * build, ry: 3.5, fill: SHADOW }] as Shape[])),
    ...(BEHIND.has(style) ? hairBehind(style, crown) : []),
    ...(head ? [] : body),
    { kind: "circle", cx: 32, cy: 24, r: 16, fill: skin },
    ...hairInFront(style, crown),
    { kind: "circle", cx: 25.5, cy: 25, r: 2.1, fill: eyes },
    { kind: "circle", cx: 38.5, cy: 25, r: 2.1, fill: eyes },
    { kind: "circle", cx: 26.1, cy: 24.4, r: 0.7, fill: "#ffffff", opacity: 0.85 },
    { kind: "circle", cx: 39.1, cy: 24.4, r: 0.7, fill: "#ffffff", opacity: 0.85 },
    {
      kind: "path",
      d: "M27.5 31.5q4.5 4 9 0",
      stroke: shade(skin, 0.62),
      width: 1.9,
    },
    { kind: "circle", cx: 21, cy: 30, r: 2.8, fill: "#f6a6b6", opacity: 0.32 },
    { kind: "circle", cx: 43, cy: 30, r: 2.8, fill: "#f6a6b6", opacity: 0.32 },
    ...(figure.accessories ?? []).flatMap(accessory),
  ];
}

export { K };
