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
 * Never throws. A provider that times out, refuses, or answers nonsense is
 * indistinguishable here from one that simply has nothing to say — a
 * suggestion is a shortcut, never a lock, so a failure here must read to the
 * caller exactly like "no matches" rather than as an error the reader has to
 * do something about.
 */
export async function lookupAddresses(query: string, locale: string): Promise<AddressSuggestion[]> {
  const { url } = providerConfig();
  const lang = SUPPORTED_LANGS.has(locale) ? locale : "en";
  const key = process.env.ADDRESS_LOOKUP_API_KEY;

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return [];
  }
  target.searchParams.set("q", query);
  target.searchParams.set("limit", String(MAX_RESULTS));
  target.searchParams.set("lang", lang);
  if (key) target.searchParams.set("key", key);

  let body: { features?: PhotonFeature[] };
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [];
    body = (await response.json()) as { features?: PhotonFeature[] };
  } catch {
    return [];
  }

  const out: AddressSuggestion[] = [];
  for (const feature of body.features ?? []) {
    const p = feature.properties ?? {};
    if (p.type !== "house") continue;
    const countrycode = (p.countrycode ?? "").toUpperCase();
    const line1 = line1From(p.street ?? "", p.housenumber ?? "", countrycode);
    if (line1 === "") continue;
    out.push({ line1, postcode: p.postcode ?? "", city: p.city ?? "", country: countrycode });
  }
  return out;
}
