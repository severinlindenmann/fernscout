import type { CostsImporter } from "./schema";
import revolut from "./revolut";
import revolutAccount from "./revolut-account";

/**
 * Every statement importer, in one list — see `../gps/index.ts` for why this
 * is a list rather than a directory scan.
 *
 * Order is the order `detect` is tried in. Put a stricter format above a
 * looser one; a CSV is the easiest file in the world to claim.
 */
// `revolut-account` first: it matches one exact header, where the
// consolidated reader also accepts a bare `Date,Description,` line.
export const COSTS_IMPORTERS: CostsImporter[] = [revolutAccount, revolut];

/** The ids, for the API's listing and for `/openapi.json`'s enum. */
export const COSTS_FORMATS = COSTS_IMPORTERS.map((i) => i.id);
