import {
  AGE_SCALE,
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
 * A figure in, SVG out. **Pure** — no React, no DOM, no `fs`, no server-only.
 *
 * That purity is the whole point of the module, and it is load-bearing rather
 * than tidy. Three things need this drawing and only one of them is a browser:
 *
 * - `components/Travelers.tsx` wraps it in `motion` for the walk cycle.
 * - `GET /api/v1/<user>/travellers/preview` returns it as `image/svg+xml`, so
 *   an agent over the network can **show** somebody their figure rather than
 *   read hex codes down a phone.
 * - `scripts/travellers.mjs` renders a sheet for an agent with no server.
 *
 * A person cannot confirm a description they cannot see, so the preview is
 * not a nice-to-have; and a renderer that lives inside the component cannot
 * be reached without booting Next.
 */

/**
 * Painter's order, and most of the work is in getting it right:
 *
 *  1. shadow            6. arms, hands
 *  2. hair behind       7. head
 *  3. backpack          8. hair in front
 *  4. legs, feet        9. eyes, mouth, cheeks
 *  5. torso            10. accessories
 *
 * Long hair falls behind the body; a hat sits over the hairline; glasses sit
 * over the eyes. Each of those is one swap away from looking like a bug.
 */

/** Styles with a part drawn *behind* the body, at layer 2. */
const BEHIND: ReadonlySet<string> = new Set([
  "long",
  "braids",
  "ponytail",
  "bun",
  "headscarf",
]);

/** A ring of overlapping circles around the skull, for curls and coils. */
function clump(fill: string, r: number, radius: number, from: number, to: number, n: number) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const a = ((from + ((to - from) * i) / (n - 1)) * Math.PI) / 180;
    const cx = (32 + Math.cos(a) * radius).toFixed(1);
    const cy = (24 - Math.sin(a) * radius).toFixed(1);
    out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
  }
  return out;
}

function hairBehind(style: HairStyle, c: string): string {
  switch (style) {
    case "long":
      return `<path d="M14 26q-3 26 2 38q16 5 32 0q5-12 2-38z" fill="${c}"/>`;
    case "braids":
      return (
        `<path d="M15 27q-2 13 0 21q17 4 34 0q2-8 0-21z" fill="${c}"/>` +
        `<path d="M13.5 30q-4 18 0 30q4 2 7 0q2-16-1-30z" fill="${c}"/>` +
        `<path d="M50.5 30q4 18 0 30q-4 2-7 0q-2-16 1-30z" fill="${c}"/>` +
        `<g fill="${shade(c, 0.78)}" opacity="0.75">` +
        `<ellipse cx="16.6" cy="42" rx="4.4" ry="1.5"/><ellipse cx="16.4" cy="50" rx="4.2" ry="1.5"/>` +
        `<ellipse cx="47.4" cy="42" rx="4.4" ry="1.5"/><ellipse cx="47.6" cy="50" rx="4.2" ry="1.5"/></g>`
      );
    case "ponytail":
      return `<path d="M45 22q11 5 11 20q0 12-7 16q-5 1-4.5-4q6-6 5-16q-1-11-8-13z" fill="${c}"/>`;
    case "bun":
      return (
        `<circle cx="45" cy="10.5" r="7.6" fill="${c}"/>` +
        `<circle cx="45" cy="10.5" r="4" fill="${shade(c, 0.82)}" opacity="0.6"/>`
      );
    case "headscarf":
      return `<path d="M15 25q-4 22 1 33q16 5 32 0q5-11 1-33z" fill="${c}"/>`;
    default:
      return "";
  }
}

function hairInFront(style: HairStyle, c: string): string {
  switch (style) {
    case "bald":
      return `<ellipse cx="27" cy="14" rx="6" ry="3" fill="#ffffff" opacity="0.18"/>`;
    case "buzz":
      return `<path d="M17 23a15 15 0 0130 0q-5-6-15-6t-15 6z" fill="${c}" opacity="0.92"/>`;
    case "short":
      return `<path d="M16.5 22a15.5 15.5 0 0131 0q-4-6-9-4q-6-4-13 0q-6-1-9 4z" fill="${c}"/>`;
    case "tousled":
      return `<path d="M16.5 22a15.5 15.5 0 0131 0q-3-7-8-4q-5-5-11-1q-4-3-8 1q-3-1-4 4z" fill="${c}"/>`;
    case "curly":
      return (
        clump(c, 5.6, 15.5, 8, 172, 9) +
        `<path d="M17 24a15 15 0 0130 0q-6-8-15-8t-15 8z" fill="${c}"/>`
      );
    case "coils":
      return (
        clump(c, 3.7, 16.2, 4, 176, 13) +
        clump(c, 3.5, 12.4, 22, 158, 8) +
        `<path d="M17.5 24a14.5 14.5 0 0129 0q-6-7-14.5-7t-14.5 7z" fill="${c}"/>`
      );
    case "braids":
      return (
        `<path d="M16 23a16 16 0 0132 0q-5-8-16-8t-16 8z" fill="${c}"/>` +
        `<path d="M31.2 8.4h1.6l0.6 6h-2.8z" fill="${shade(c, 0.75)}"/>`
      );
    case "bun":
    case "ponytail":
      return `<path d="M16.5 23a15.5 15.5 0 0131 0q-6-7-15.5-7t-15.5 7z" fill="${c}"/>`;
    case "headscarf":
      return (
        `<path d="M15.6 26a16.4 16.4 0 0132.8 0q-1-13-16.4-13t-16.4 13z" fill="${c}"/>` +
        `<path d="M15.8 25q-0.6 11 3 17q3-9 2-17z" fill="${c}"/>` +
        `<path d="M48.2 25q0.6 11-3 17q-3-9-2-17z" fill="${c}"/>` +
        `<path d="M15.6 26a16.4 16.4 0 0132.8 0q-2 2-3.4 1.4a14 14 0 00-26 0q-1.4 0.6-3.4-1.4z" ` +
        `fill="${shade(c, 0.85)}" opacity="0.7"/>`
      );
    case "long":
    default:
      return `<path d="M16 23a16 16 0 0132 0q-4-9-16-9t-16 9z" fill="${c}"/>`;
  }
}

function accessory(name: string): string {
  switch (name) {
    case "glasses":
      return (
        `<g fill="none" stroke="#33261c" stroke-width="1.5" opacity="0.9">` +
        `<circle cx="25.5" cy="25" r="4.6"/><circle cx="38.5" cy="25" r="4.6"/>` +
        `<path d="M30.1 25h3.8M20.9 24.2 17 22.9M43.1 24.2 47 22.9"/></g>`
      );
    case "sunglasses":
      return (
        `<g fill="#2b3648"><rect x="20.4" y="21.2" width="10" height="7.2" rx="3.2"/>` +
        `<rect x="33.6" y="21.2" width="10" height="7.2" rx="3.2"/>` +
        `<path d="M30.4 23.6h3.2v1.6h-3.2z"/>` +
        `<path d="M20.4 23.4 16.8 22.2l0.4-1.5 3.9 1.3zM43.6 23.4l3.6-1.2-0.4-1.5-3.9 1.3z"/></g>`
      );
    case "hat":
      return (
        `<g><ellipse cx="32" cy="14.5" rx="25" ry="5.6" fill="#e0c48b"/>` +
        `<ellipse cx="32" cy="13.6" rx="25" ry="5.6" fill="#eed9a8"/>` +
        `<path d="M20.5 14q0.6-12 11.5-12t11.5 12z" fill="#eed9a8"/>` +
        `<path d="M20.6 12.6q11-3 22.8 0l0.2 1.6q-11.6-3-23.2 0z" fill="#b98f4e"/></g>`
      );
    case "cap":
      return (
        `<g><path d="M18.5 14.6a13.5 13.5 0 0127 0z" fill="#3fa9c4"/>` +
        `<path d="M18.5 14.6q-0.2-1.6 1-1.8 12-2 25 0 1.2 0.2 1 1.8z" fill="#2f89a1"/>` +
        `<path d="M45.5 14.6q11 0.6 13.5 4-2.5 2.4-13.5 2.4z" fill="#2f89a1"/></g>`
      );
    case "beanie":
      return (
        `<g><path d="M18.5 15a13.5 13.5 0 0127 0z" fill="#c2653a"/>` +
        `<rect x="17.4" y="13.4" width="29.2" height="5" rx="2.5" fill="#a8532c"/>` +
        `<circle cx="32" cy="0.6" r="3.6" fill="#eed9a8"/>` +
        `<path d="M32 1.6v6" stroke="#c2653a" stroke-width="2.4"/></g>`
      );
    case "scarf":
      return (
        `<g fill="#c2334a"><path d="M21.6 38.6q10.4 6.4 20.8 0 1.4 5.2-0.8 8-9.6 4.4-19.2 0-2.2-2.8-0.8-8z"/>` +
        `<path d="M25 45.4q3 1 5.6 1l-1.2 13.4q-2.6 0.6-4.6-0.4z" opacity="0.92"/></g>`
      );
    case "camera":
      return (
        `<g><path d="M23 41.4 30 55.6M41 41.4 34 55.6" stroke="#5e4632" stroke-width="1.9" fill="none"/>` +
        `<rect x="25.4" y="53.6" width="13.2" height="9.4" rx="2.4" fill="#2b3648"/>` +
        `<circle cx="32" cy="58.3" r="3.4" fill="#8fe0ef"/><circle cx="32" cy="58.3" r="1.7" fill="#1e293b"/>` +
        `<rect x="34.6" y="55.4" width="2.6" height="1.8" rx="0.9" fill="#ffd23f"/></g>`
      );
    case "stick":
      return (
        `<g><rect x="50.4" y="36" width="2.6" height="52" rx="1.3" fill="#9c7a4e"/>` +
        `<circle cx="51.7" cy="35.4" r="2.6" fill="#7d6140"/></g>`
      );
    default:
      return "";
  }
}

export type RenderOptions = {
  /** Rendered width in CSS pixels. Height follows from the aspect. */
  width?: number;
  /** `"head"` crops to the head and shoulders — the same drawing, a different
   *  viewBox, which is what the vocabulary swatches use. */
  crop?: "full" | "head";
  /** What a screen reader is told. */
  label?: string;
  /**
   * Hide from assistive technology entirely. What a party of five wants: the
   * container says "five illustrated travellers" once, and five nested
   * `role="img"` elements underneath it would say it again, five times.
   */
  decorative?: boolean;
  /** Extra scale on top of `age`, for a rank standing nearer or further. */
  scale?: number;
  /** Class on the `<svg>` — the component uses it to hang the walk cycle on. */
  className?: string;
  /** Inline style on the `<svg>`, e.g. an `animation-delay`. */
  style?: string;
};

/** The height of a figure rendered at `width`, in the same units. */
export function figureHeight(width: number, crop: "full" | "head" = "full"): number {
  return Math.round(width * (crop === "head" ? 64 / 60 : 1.42));
}

/**
 * The head is a circle of `r=16` in a 64-wide viewBox, so it spans exactly
 * **half** a figure. Everything about how close two figures may stand comes
 * back to this number; see `MIN_STEP` in `layout.ts`.
 */
export const HEAD_WIDTH_RATIO = 32 / 64;

/** One figure, as a complete `<svg>` element. */
export function renderFigure(figure: Figure, options: RenderOptions = {}): string {
  const skin = colour(figure.skin, SKIN, "medium");
  const hair = colour(figure.hair, HAIR, "dark-brown");
  const eyes = colour(figure.eyes, EYES, "brown");
  const shirt = colour(figure.shirt, CLOTH, "sky");
  const pants = colour(figure.pants, CLOTH, "slate");
  const pack = figure.pack === "none" ? null : colour(figure.pack, CLOTH, "yellow");
  const style: HairStyle = figure.hairStyle ?? "short";

  /**
   * A headscarf drawn in the hair colour just reads as long hair — which is
   * exactly what the first render of the preset sheet showed. It is fabric,
   * so it takes a cloth colour, defaulting to the shirt because that is
   * always distinct from both skin and hair.
   */
  const crown =
    style === "headscarf"
      ? figure.headscarf
        ? colour(figure.headscarf, CLOTH, "sky")
        : shirt
      : hair;

  const build = BUILD_SCALE[figure.build ?? "average"];
  const head = options.crop === "head";
  const width = options.width ?? 76;
  const height = figureHeight(width, head ? "head" : "full");
  const scale = AGE_SCALE[figure.age ?? "adult"] * (options.scale ?? 1);
  const viewBox = head ? "2 -9 60 64" : "-6 -6 76 106";

  /**
   * `overflow: hidden`, not `visible`. Nothing needs to paint outside the
   * viewBox, and `visible` let long hair and braids spill across the labels
   * underneath them in the head crop.
   */
  const body = pack
    ? `<rect x="6" y="40" width="15" height="21" rx="6" fill="${pack}"/>` +
      `<rect x="9" y="46" width="9" height="3" rx="1.5" fill="rgba(0,0,0,0.14)"/>`
    : "";

  const torso =
    `<g transform="translate(32,0) scale(${build},1) translate(-32,0)">` +
    `<rect x="21" y="64" width="9.5" height="24" rx="4.75" fill="${pants}"/>` +
    `<rect x="33.5" y="64" width="9.5" height="24" rx="4.75" fill="${pants}"/>` +
    `<ellipse cx="25.5" cy="89" rx="6.5" ry="3.2" fill="#2b3648"/>` +
    `<ellipse cx="38.5" cy="89" rx="6.5" ry="3.2" fill="#2b3648"/>` +
    `<path d="M17 42q15-6 30 0l2 24q-17 6-34 0z" fill="${shirt}"/>` +
    `<path d="M17 42q15-6 30 0l0.6 7q-15-5-31 0z" fill="${shade(shirt, 0.8)}" opacity="0.6"/>` +
    `<rect x="11.5" y="44" width="8" height="22" rx="4" fill="${shirt}"/>` +
    `<rect x="44.5" y="44" width="8" height="22" rx="4" fill="${shirt}"/>` +
    `<circle cx="15.5" cy="67" r="4.6" fill="${skin}"/>` +
    `<circle cx="48.5" cy="67" r="4.6" fill="${skin}"/></g>`;

  const parts = [
    head
      ? ""
      : `<ellipse cx="32" cy="92" rx="${(17 * build).toFixed(1)}" ry="3.5" fill="var(--fig-shadow, rgba(30,41,59,0.15))"/>`,
    BEHIND.has(style) ? hairBehind(style, crown) : "",
    head ? "" : body + torso,
    `<circle cx="32" cy="24" r="16" fill="${skin}"/>`,
    hairInFront(style, crown),
    `<circle cx="25.5" cy="25" r="2.1" fill="${eyes}"/>`,
    `<circle cx="38.5" cy="25" r="2.1" fill="${eyes}"/>`,
    `<circle cx="26.1" cy="24.4" r="0.7" fill="#ffffff" opacity="0.85"/>`,
    `<circle cx="39.1" cy="24.4" r="0.7" fill="#ffffff" opacity="0.85"/>`,
    `<path d="M27.5 31.5q4.5 4 9 0" stroke="${shade(skin, 0.62)}" stroke-width="1.9" ` +
      `fill="none" stroke-linecap="round"/>`,
    `<circle cx="21" cy="30" r="2.8" fill="#f6a6b6" opacity="0.32"/>`,
    `<circle cx="43" cy="30" r="2.8" fill="#f6a6b6" opacity="0.32"/>`,
    (figure.accessories ?? []).map(accessory).join(""),
  ].join("");

  const cls = options.className ? ` class="${options.className}"` : "";
  const inline = options.style ? `overflow:hidden;${options.style}` : "overflow:hidden";
  const described = options.decorative
    ? `aria-hidden="true"`
    : `role="img" aria-label="${escapeAttr(options.label ?? "an illustrated traveller")}"`;

  return (
    `<svg${cls} width="${width}" height="${height}" viewBox="${viewBox}" ` +
    `style="${inline}" xmlns="http://www.w3.org/2000/svg" ${described}>` +
    `<g transform="translate(32,96) scale(${scale}) translate(-32,-96)">${parts}</g>` +
    `</svg>`
  );
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
