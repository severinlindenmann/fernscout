/**
 * "What is this thing I just pasted?" — B2010.
 *
 * The Planner's one box takes a Google/Apple Maps link, a coordinate pair, a
 * plain blog URL, a cost line ("1640 flights zürich bangkok") or a place
 * name, and nothing could tell them apart before this. This module is only
 * the classification — a pure function, no filesystem, no network, safe to
 * unit-test with a table — because the two shapes that *do* need the network
 * (resolving a Maps link, reverse-geocoding a coordinate) belong in the route
 * that can be rate-limited and gated, not in something re-run on every
 * keystroke of a test file.
 *
 * Deliberately does not import `lib/mapsLink.ts`: that module is
 * `server-only` (it fetches), and importing it here would taint this file
 * with the same marker for no reason — the route already imports it to do
 * the actual host check and fetch. `firstUrl` below mirrors its own
 * `findMapsLink` extraction (scan for `https?://\S+`, trim trailing
 * sentence punctuation) only so a link pasted mid-sentence parses the same
 * way in both places.
 */

import { COST_CATEGORIES, type CostCategory } from "@/lib/costFormat";
import { normalizeCurrency } from "@/lib/currency";

export type ParsedPastedText =
  | { kind: "place"; lat: number; lng: number; name?: string }
  | { kind: "url"; url: string }
  | { kind: "coordinates"; lat: number; lng: number }
  | { kind: "cost"; amount: number; currency?: string; label: string; category?: CostCategory }
  | { kind: "place-query"; q: string };

/** The first `http(s)` URL in the text, trailing punctuation trimmed — the
 * same shape `lib/mapsLink.ts`'s `findMapsLink` extracts, kept as a
 * one-line duplicate rather than an import so this module stays fetch-free. */
function firstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) return null;
  return match[0].replace(/[).,!?]+$/, "");
}

/** The Google and Apple Maps hosts whose links carry a place — shared with
 * `lib/mapsLink.ts`, which only ever fetches these. */
export const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "google.com",
  "www.google.com",
  "maps.apple.com",
]);

const PAIR_RE = /^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/;

function pair(value: string | null): { lat: number; lng: number } | null {
  const m = value?.trim().match(PAIR_RE);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

/**
 * The place a Google or Apple Maps URL names, read off the URL itself — B2086.
 * `!3d…!4d…` (the pin) wins over `@lat,lng` (the map's centre); then the
 * `q`/`ll`/`query` pairs. The name is the `/place/<name>/` segment or an
 * Apple `q` that is not a pair. A short link (`maps.app.goo.gl/…`) carries
 * no coordinates and answers null; following it needs the network.
 */
export function readMapsUrl(url: URL): { lat: number; lng: number; name?: string } | null {
  if (!MAPS_HOSTS.has(url.hostname)) return null;
  const pin = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const at = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const found =
    pair(pin && `${pin[1]},${pin[2]}`) ??
    pair(at && `${at[1]},${at[2]}`) ??
    pair(url.searchParams.get("q")) ??
    pair(url.searchParams.get("ll")) ??
    pair(url.searchParams.get("query"));
  if (!found) return null;
  const segment = url.pathname.match(/\/place\/([^/]+)/)?.[1];
  const q = url.searchParams.get("q");
  let name: string | undefined;
  try {
    name = segment ? decodeURIComponent(segment.replace(/\+/g, " ")).trim() : undefined;
  } catch {
    name = undefined;
  }
  if (!name && q && !pair(q)) name = q.trim();
  return name ? { ...found, name } : found;
}

const COORDINATE_RE = /^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/;

/** A leading amount and a non-empty label — "1640 flights zürich bangkok".
 * Requires whitespace between the number and the label, so a bare number
 * with nothing after it (or a word running straight into it) falls through
 * to `place-query` rather than becoming a cost with an empty label. */
const COST_RE = /^(\d+(?:[.,]\d+)?)\s+(\S.*)$/;

/** One example word per category the ticket names — a suggestion only, so a
 * short, obviously-incomplete list costs nothing: the owner sees and can
 * correct it before anything is written. */
const CATEGORY_KEYWORDS: Partial<Record<CostCategory, string[]>> = {
  flights: ["flight", "flights", "flug", "flüge"],
  accommodation: ["hotel", "hotels", "hostel", "hostels"],
  transport: ["train", "trains", "bus", "buses", "taxi", "taxis"],
};

function guessCategory(label: string): CostCategory | undefined {
  const words: string[] = label.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  for (const category of COST_CATEGORIES) {
    const keywords: string[] = CATEGORY_KEYWORDS[category] ?? [];
    if (keywords.some((keyword) => words.includes(keyword))) return category;
  }
  return undefined;
}

/** Any three-letter all-caps token — "1640 CHF flights zürich" — rather than
 * anything that merely uppercases to three letters, which would also catch
 * a three-letter place name like "Zug". A currency written any other way
 * (lower-case, or spelled out) is left for the owner to fill in. */
function guessCurrency(label: string): string | undefined {
  const match = label.match(/\b[A-Z]{3}\b/);
  return match ? normalizeCurrency(match[0]) || undefined : undefined;
}

export function parsePastedText(text: string): ParsedPastedText {
  const trimmed = text.trim();

  const url = firstUrl(trimmed);
  if (url) {
    let place: ReturnType<typeof readMapsUrl> = null;
    try {
      place = readMapsUrl(new URL(url));
    } catch {
      place = null;
    }
    return place ? { kind: "place", ...place } : { kind: "url", url };
  }

  const coords = trimmed.match(COORDINATE_RE);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { kind: "coordinates", lat, lng };
    }
  }

  const cost = trimmed.match(COST_RE);
  if (cost) {
    const amount = Number(cost[1].replace(",", "."));
    const label = cost[2].trim();
    if (Number.isFinite(amount) && label !== "") {
      const currency = guessCurrency(label);
      const category = guessCategory(label);
      return {
        kind: "cost",
        amount,
        ...(currency ? { currency } : {}),
        label,
        ...(category ? { category } : {}),
      };
    }
  }

  return { kind: "place-query", q: trimmed };
}
