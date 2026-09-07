import type { CostsImporter } from "./schema";
import revolut from "./revolut";

/**
 * Every statement importer, in one list — see `../gps/index.ts` for why this
 * is a list rather than a directory scan.
 *
 * Order is the order `detect` is tried in. Put a stricter format above a
 * looser one; a CSV is the easiest file in the world to claim.
 */
export const COSTS_IMPORTERS: CostsImporter[] = [revolut];

/** The ids, for the API's listing and for `/openapi.json`'s enum. */
export const COSTS_FORMATS = COSTS_IMPORTERS.map((i) => i.id);
