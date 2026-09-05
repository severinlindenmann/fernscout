import fs from "node:fs";
import path from "node:path";
import { arrangeParty } from "../lib/travellers/layout";
import { STARTING_POINTS } from "../lib/travellers/presets";
import { figureHeight, renderFigure } from "../lib/travellers/render";
import {
  ACCESSORIES,
  HAIR_STYLES,
  type Figure,
} from "../lib/travellers/vocabulary";

/**
 * `npm run travellers` — draw a party, or the whole vocabulary, to a file.
 *
 * The third consumer of `lib/travellers/render.ts`, and the one for an agent
 * working on disk with no server running. The preview endpoint needs Next up;
 * this needs nothing, so "show me what I just wrote into trip.md" has an
 * answer during `add-a-trip` as well as over the network.
 *
 *   npm run travellers -- --sheet
 *   npm run travellers -- --party '[{"skin":"deep","hairStyle":"coils"}]'
 *   npm run travellers -- --party '…' --out /tmp/party.svg
 *
 * It writes SVG, which every browser and every image viewer opens. Rendering
 * to PNG would want a headless browser, and this file exists precisely for the
 * case where nothing is running.
 */

function usage(): never {
  console.error(
    [
      "Draw Fernscout travellers to an SVG file.",
      "",
      "  npm run travellers -- --sheet                 every style and accessory",
      "  npm run travellers -- --party '<json>'        one party, as the hero arranges it",
      "",
      "  --out <file>   where to write (default: travellers.svg in the cwd)",
      "  --size <px>    figure width (default 106)",
      "",
      "The vocabulary is lib/travellers/vocabulary.ts, and",
      "GET /api/v1/<user>/travellers/presets serves the same list.",
    ].join("\n"),
  );
  process.exit(1);
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** A party laid out exactly as the hero would lay it out. */
function partySvg(figures: Figure[], size: number): string {
  const { placements, width, height } = arrangeParty(figures, size);
  const inner = placements
    .map((p) => {
      const top = height - p.bottom - figureHeight(size) * p.scale;
      return (
        `<g transform="translate(${p.x.toFixed(1)}, ${top.toFixed(1)}) scale(${p.scale})">` +
        renderFigure(p.figure, { width: size, decorative: true }) +
        `</g>`
      );
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${height}" ` +
    `viewBox="0 0 ${Math.round(width)} ${height}">` +
    `<rect width="100%" height="100%" fill="#fff3dc"/>${inner}</svg>`
  );
}

/** Every starting point, every hair style, every accessory, with labels. */
function sheetSvg(size: number): string {
  const cell = size + 34;
  const rowHeight = figureHeight(size) + 26;
  const columns = 6;

  const specimens: Array<{ label: string; figure: Figure; crop?: "head" }> = [
    ...STARTING_POINTS.map((p) => ({ label: p.name, figure: p.figure })),
    ...HAIR_STYLES.map((hairStyle) => ({
      label: hairStyle,
      figure: { skin: "medium", hair: "black", hairStyle } as Figure,
      crop: "head" as const,
    })),
    ...ACCESSORIES.map((a) => ({
      label: a,
      figure: {
        skin: "light-medium",
        hair: "dark-brown",
        hairStyle: "short",
        shirt: "cream",
        pack: "none",
        accessories: [a],
      } as Figure,
    })),
  ];

  const rows = Math.ceil(specimens.length / columns);
  const width = columns * cell;
  const height = rows * rowHeight + 20;

  const cells = specimens
    .map((s, i) => {
      const x = (i % columns) * cell + (cell - size) / 2;
      const y = Math.floor(i / columns) * rowHeight + 10;
      return (
        `<g transform="translate(${x}, ${y})">` +
        renderFigure(s.figure, { width: size, crop: s.crop ?? "full", decorative: true }) +
        `<text x="${size / 2}" y="${figureHeight(size, s.crop ?? "full") + 15}" ` +
        `text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" ` +
        `fill="#44546c">${s.label}</text></g>`
      );
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#fffaf0"/>${cells}</svg>`
  );
}

const size = Math.max(24, Math.min(240, Number(flag("size")) || 106));
const out = path.resolve(flag("out") ?? "travellers.svg");

let svg: string;
if (process.argv.includes("--sheet")) {
  svg = sheetSvg(size);
} else {
  const raw = flag("party");
  if (!raw) usage();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("--party is JSON, and this did not parse.");
    process.exit(1);
  }
  const figures = (Array.isArray(parsed) ? parsed : [parsed]) as Figure[];
  if (figures.length === 0) usage();
  svg = partySvg(figures, size);
}

fs.writeFileSync(out, svg, "utf8");
console.log(out);
