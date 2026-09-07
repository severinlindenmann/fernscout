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

function line1From(street: string, housenumber: string, countrycode: string): string {
  if (housenumber === "") return street;
  if (street === "") return housenumber;
  return STREET_FIRST_COUNTRIES.has(countrycode)
    ? `${street} ${housenumber}`
    : `${housenumber} ${street}`;
}

/** `features.addressLookup`'s own provider/url — validated only as far as
 * `lib/capabilities.ts` needs to (env presence); a bad URL here is a runtime
 * fetch failure, caught below the same as an unreachable provider. */
function providerConfig(): { url: string } {
  const feature = loadServerConfig().features.addressLookup as { url?: string };
  return { url: typeof feature.url === "string" && feature.url !== "" ? feature.url : DEFAULT_URL };
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
