import "server-only";
import type { AddressSuggestion } from "./addressLookupTypes";
import { MAX_QUERY_LEN, MIN_QUERY_LEN } from "./addressLookupTypes";
import { loadServerConfig } from "./config";

/**
 * The address lookup capability's own provider client — B399.
 *
 * One shape in, one shape out, regardless of which provider is configured:
 * a plain query-string GET, answered as Photon's own GeoJSON. Anything
 * pointed at a URL that answers differently is future work, not this
 * ticket's — the owner asked for Bahnhofstrasse-style type-ahead, which is
 * what Photon (`photon.komoot.io`, no key, OSM data) already does for free,
 * and every knob below exists so a self-hosted Photon or another provider
 * with the same response shape is a config change rather than a code one.
 *
 * `MIN_QUERY_LEN`/`MAX_QUERY_LEN`/`AddressSuggestion` live in
 * `addressLookupTypes.ts` — a plain object with no `server-only` import, so
 * `AddressLookupField.tsx` (a client component) can read the same two
 * constants and the same shape without pulling this file's fetch logic into
 * the browser bundle. Re-exported here so this module's own callers (the
 * route) need one import, not two.
 */
export type { AddressSuggestion };
export { MAX_QUERY_LEN, MIN_QUERY_LEN };

/** Capped so a single keystroke can't ask the provider (or this route's own
 * response body) to do more work than a type-ahead list ever shows. */
const MAX_RESULTS = 8;

const DEFAULT_URL = "https://photon.komoot.io/api/";

/** Photon's own supported languages — checked against the live service for
 * B399. `hu` is not among them; an unsupported journal locale gets English
 * suggestions rather than a `lang` value the provider would either ignore or
 * error on. */
const SUPPORTED_LANGS = new Set(["de", "en", "fr", "it"]);

/**
 * Countries where the housenumber follows the street ("Bahnhofstrasse 12").
 * Everywhere else it leads ("12 Bahnhofstrasse and 12 rue de Rivoli") —
 * B399's own live check of the provider names Zürich and Paris as the two
 * cases that disagree.
 */
const STREET_FIRST_COUNTRIES = new Set(["DE", "AT", "CH", "LI"]);

type PhotonFeature = {
  properties?: {
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    countrycode?: string;
    /** Only `"house"` is precise enough to post to — a `"street"` or
     * `"city"` hit is a place, not an address, and offering it as one is
     * how a card gets sent to a road. */
    type?: string;
  };
};

type PhotonPlaceFeature = {
  properties?: {
    name?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
    osm_value?: string;
  };
  geometry?: {
    coordinates?: unknown;
  };
};

function line1From(street: string, housenumber: string, countrycode: string): string {
  if (housenumber === "") return street;
  if (street === "") return housenumber;
  return STREET_FIRST_COUNTRIES.has(countrycode)
    ? `${street} ${housenumber}`
    : `${housenumber} ${street}`;
}

/**
 * Photon's reverse endpoint sits beside its forward one at `/reverse` rather
 * than `/api/` — true of the public instance and of a self-hosted Photon, but
 * not guaranteed of anything else `url` might point at. Only a fallback, so
 * an instance whose provider is *not* shaped like Photon still starts up; the
 * fix is `reverseUrl` in config, not this guess.
 */
function derivedReverseUrl(url: string): string {
  return url.replace(/\/api\/?$/, "/reverse");
}

/** `features.addressLookup`'s own provider/url(s) — validated only as far as
 * `lib/capabilities.ts` needs to (env presence); a bad URL here is a runtime
 * fetch failure, caught below the same as an unreachable provider.
 *
 * `reverseUrl` — B710 — used to be guessed from `url` unconditionally, on the
 * assumption every provider is shaped like Photon (`/api/` → `/reverse`).
 * Nothing checks that assumption, so a provider that is not shaped that way
 * failed reverse lookups silently: `reversePlace` never throws, so a wrong
 * guess reads as "the provider found nothing" rather than as a
 * misconfiguration. An instance can now say the real one; absent, the guess
 * is unchanged.
 */
function providerConfig(): { url: string; reverseUrl: string } {
  const feature = loadServerConfig().features.addressLookup as { url?: string; reverseUrl?: string };
  const url = typeof feature.url === "string" && feature.url !== "" ? feature.url : DEFAULT_URL;
  const reverseUrl =
    typeof feature.reverseUrl === "string" && feature.reverseUrl !== ""
      ? feature.reverseUrl
      : derivedReverseUrl(url);
  return { url, reverseUrl };
}

/** What `/api/health` reports, so an operator can see the guessed URL rather
 *  than take it on faith — B710. Same values `reversePlace` actually uses. */
export function addressLookupEndpoints(): { url: string; reverseUrl: string } {
  return providerConfig();
}

/**
 * Ask the configured provider for real addresses matching `query`.
 *
 * Never throws. Returns `null` — not `[]` — when the provider timed out,
 * refused, or answered nonsense: that is a failure the reader should be told
 * about, and it must stay distinguishable from a `[]` the provider returned
 * on purpose because nothing matched. B639: the two used to collapse into
 * the same empty list, which is what let a rate-limited provider sit silent
 * for a week before anyone noticed. The route and the field are what turn
 * `null` into a message; this module's job is only to keep the two apart.
 */
export async function lookupAddresses(query: string, locale: string): Promise<AddressSuggestion[] | null> {
  const { url } = providerConfig();
  const lang = SUPPORTED_LANGS.has(locale) ? locale : "en";
  const key = process.env.ADDRESS_LOOKUP_API_KEY;

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  target.searchParams.set("q", query);
  target.searchParams.set("limit", String(MAX_RESULTS));
  target.searchParams.set("lang", lang);
  if (key) target.searchParams.set("key", key);

  let body: { features?: PhotonFeature[] };
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    body = (await response.json()) as { features?: PhotonFeature[] };
  } catch {
    return null;
  }

  const out: AddressSuggestion[] = [];
  // Photon can hand back a building and a shop at the same address as two
  // distinct features (B415) — indistinguishable once mapped down to the
  // four fields a suggestion actually carries, so dedupe on those four,
  // keeping the first occurrence, before anything else sees the list.
  const seen = new Set<string>();
  for (const feature of body.features ?? []) {
    const p = feature.properties ?? {};
    if (p.type !== "house") continue;
    const countrycode = (p.countrycode ?? "").toUpperCase();
    const line1 = line1From(p.street ?? "", p.housenumber ?? "", countrycode);
    if (line1 === "") continue;
    const suggestion = { line1, postcode: p.postcode ?? "", city: p.city ?? "", country: countrycode };
    const key = `${suggestion.line1}|${suggestion.postcode}|${suggestion.city}|${suggestion.country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(suggestion);
  }
  return out;
}

/** What a coordinate turns into: a place a day can be labelled with, never a
 *  street address. See `reversePlace`. */
export type ReversePlace = { location: string; country: string; countryCode: string };

export type GeocodeContextCoordinate = { lat: number; lng: number };

export type GeocodeCandidate = {
  displayName: string;
  country: string;
  countryCode: string;
  adminRegion: string;
  lat: number;
  lon: number;
  type?: string;
};

function combinedQuery(query: string, regionHint?: string, countryHint?: string): string {
  return [query, regionHint, countryHint].map((part) => part?.trim() ?? "").filter(Boolean).join(", ");
}

function centroid(points: readonly GeocodeContextCoordinate[]): GeocodeContextCoordinate | null {
  const valid = points.filter(
    ({ lat, lng }) =>
      Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180,
  );
  if (valid.length === 0) return null;
  const totals = valid.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: totals.lat / valid.length, lng: totals.lng / valid.length };
}

function uniqueParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts.map((value) => value.trim()).filter(Boolean)) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

function geocodeCandidate(feature: PhotonPlaceFeature): GeocodeCandidate | null {
  const [lon, lat] = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : [];
  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lon !== "number" ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  const p = feature.properties ?? {};
  const country = (p.country ?? "").trim();
  const countryCode = (p.countrycode ?? "").trim().toUpperCase();
  const adminRegion = uniqueParts([p.state ?? "", p.county ?? "", p.district ?? "", p.city ?? ""])[0] ?? "";
  const displayName = uniqueParts([p.name ?? "", p.city ?? "", p.district ?? "", adminRegion, country]).join(", ");
  if (displayName === "" || country === "" || countryCode === "" || adminRegion === "") return null;

  const type = (p.type ?? p.osm_value ?? "").trim();

  return {
    displayName,
    country,
    countryCode,
    adminRegion,
    lat,
    lon,
    ...(type ? { type } : {}),
  };
}

function distanceSquared(a: { lat: number; lon: number }, b: GeocodeContextCoordinate): number {
  return (a.lat - b.lat) ** 2 + (a.lon - b.lng) ** 2;
}

/**
 * A place name into a shortlist of candidate coordinates for a day — never one
 * silent guess.
 *
 * Uses the same provider configuration as address lookup: Photon by default,
 * or whatever compatible endpoint the instance has pointed `addressLookup.url`
 * at. `countryHint`/`regionHint` are appended to the search text, while
 * `contextCoordinates` bias both the provider query and the final ranking
 * towards where the surrounding days already were.
 */
export async function geocodePlace(
  query: string,
  locale: string,
  options: {
    countryHint?: string;
    regionHint?: string;
    contextCoordinates?: readonly GeocodeContextCoordinate[];
  } = {},
): Promise<GeocodeCandidate[] | null> {
  const { url } = providerConfig();
  const lang = SUPPORTED_LANGS.has(locale) ? locale : "en";
  const key = process.env.ADDRESS_LOOKUP_API_KEY;
  const bias = centroid(options.contextCoordinates ?? []);

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  target.searchParams.set("q", combinedQuery(query, options.regionHint, options.countryHint));
  target.searchParams.set("limit", String(MAX_RESULTS));
  target.searchParams.set("lang", lang);
  if (bias) {
    target.searchParams.set("lat", String(bias.lat));
    target.searchParams.set("lon", String(bias.lng));
  }
  if (key) target.searchParams.set("key", key);

  let body: { features?: PhotonPlaceFeature[] };
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    body = (await response.json()) as { features?: PhotonPlaceFeature[] };
  } catch {
    return null;
  }

  const out: GeocodeCandidate[] = [];
  const seen = new Set<string>();
  for (const feature of body.features ?? []) {
    const candidate = geocodeCandidate(feature);
    if (!candidate) continue;
    const key = `${candidate.displayName}|${candidate.lat}|${candidate.lon}|${candidate.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }

  if (!bias) return out;
  return [...out].sort((a, b) => distanceSquared(a, bias) - distanceSquared(b, bias));
}

/**
 * The reverse of the above: coordinates in, a place name out — B682.
 *
 * The wizard at `/agent` has a latitude and a longitude out of a photograph's
 * EXIF and needs somewhere to put on the day. This is the only route to that
 * name that is not a guess: the alternative was an agent writing down where it
 * thought the picture was taken, which is the one thing AGENTS.md forbids
 * outright.
 *
 * Same provider, same capability, same "never throws, `null` is a failure"
 * contract as `lookupAddresses`. It asks the provider's `reverse` endpoint,
 * derived from the configured `/api/` URL, so a self-hosted Photon needs no
 * second setting.
 *
 * `type: "house"` is *not* required here, unlike the address search: the whole
 * point is the town rather than the doorstep, and a day labelled with a street
 * number would be worse than one labelled with a city.
 */
export async function reversePlace(
  lat: number,
  lng: number,
  locale: string,
): Promise<ReversePlace | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const lang = SUPPORTED_LANGS.has(locale) ? locale : "en";
  const key = process.env.ADDRESS_LOOKUP_API_KEY;

  let target: URL;
  try {
    target = new URL(providerConfig().reverseUrl);
  } catch {
    return null;
  }
  target.searchParams.set("lat", String(lat));
  target.searchParams.set("lon", String(lng));
  target.searchParams.set("limit", "1");
  target.searchParams.set("lang", lang);
  if (key) target.searchParams.set("key", key);

  let body: { features?: { properties?: Record<string, string> }[] };
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    body = (await response.json()) as typeof body;
  } catch {
    return null;
  }

  const p = body.features?.[0]?.properties ?? {};
  // The town, then whatever the provider could name — a district, a mountain,
  // a region. Anything but nothing, which is what a day with no place shows.
  const location = p.city || p.name || p.state || p.country || "";
  if (location === "") return null;
  return {
    location,
    country: p.country ?? "",
    countryCode: (p.countrycode ?? "").toUpperCase(),
  };
}
