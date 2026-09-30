import "server-only";
import fs from "node:fs";
import { PMTiles } from "pmtiles";
import { NodeFileSource, nodeDecompress } from "../map/streetTiles";

/**
 * One open `PMTiles` per file, so its header and directories are read once
 * and then served from memory — B2601. A browser reading the file itself
 * needed 2–3 Range round trips per new area for those directories, and the
 * iPhone app's web view caches no Range response at all.
 *
 * Keyed by path and mtime: the monthly refresh (B2567) renames a new file
 * over the old one, and the next request opens it fresh.
 */
const open = new Map<string, { mtimeMs: number; tiles: PMTiles }>();

export function tilesFor(file: string): { mtimeMs: number; tiles: PMTiles } {
  const { mtimeMs } = fs.statSync(file);
  const cached = open.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached;
  const entry = { mtimeMs, tiles: new PMTiles(new NodeFileSource(file), undefined, nodeDecompress) };
  open.set(file, entry);
  return entry;
}
