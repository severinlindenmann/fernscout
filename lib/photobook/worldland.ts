/**
 * The baked world outline, reused for the book's route map.
 *
 * `lib/worldLand.json` already exists for the site's map: simplified coastlines
 * as SVG path data in a 1000 × 500 equirectangular space
 * (scripts/build-world-map.mjs). Printing from the same source means the paper
 * map and the screen map are the same map, and it costs one file read.
 *
 * Loaded through `fs` rather than a JSON import so that this module works
 * unchanged under `node`, `tsx`, vitest and Next — and so that a missing file
 * degrades to a route drawn on blank paper instead of a crash.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LandPath = {
  /** SVG path data: "M x,y L x,y ... Z". */
  d: string;
  /** Bounding box in map space, for culling. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

let cache: LandPath[] | null = null;

function boundsOf(d: string): Omit<LandPath, "d"> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const match of d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function landPaths(): LandPath[] {
  if (cache) return cache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "worldLand.json"),
    path.join(process.cwd(), "lib", "worldLand.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as string[];
      cache = raw.map((d) => ({ d, ...boundsOf(d) }));
      return cache;
    } catch {
      // Try the next candidate.
    }
  }
  console.warn("[photobook] lib/worldLand.json not found — the route map will have no coastlines.");
  cache = [];
  return cache;
}

/**
 * Turns "M x,y L x,y … Z" into PDF path operators, through a transform.
 *
 * SVG and PDF path syntax are close enough that this is a token walk: `M`
 * becomes `m`, `L` becomes `l`, `Z` becomes `h`, and the numbers go through
 * whatever projection the caller is using to get from map space onto paper.
 */
export function toPdfPath(d: string, project: (x: number, y: number) => [number, number]): string {
  const out: string[] = [];
  let op = "l";
  for (const token of d.match(/[MLZ]|-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) ?? []) {
    if (token === "M") {
      op = "m";
      continue;
    }
    if (token === "L") {
      op = "l";
      continue;
    }
    if (token === "Z") {
      out.push("h");
      continue;
    }
    const [sx, sy] = token.split(",");
    const [px, py] = project(Number(sx), Number(sy));
    out.push(`${px.toFixed(2)} ${py.toFixed(2)} ${op}`);
    op = "l";
  }
  return out.join(" ");
}
