import type { ContactsImporter } from "./schema";
import vcard from "./vcard";

/**
 * Every contacts importer, in one list — see `../gps/index.ts` for why this
 * is a list rather than a directory scan.
 *
 * Order is the order `detect` is tried in. One format today; a phone's own
 * export IS the vCard standard, so there is less to disagree about than a
 * bank's CSV.
 */
export const CONTACTS_IMPORTERS: ContactsImporter[] = [vcard];

/** The ids, for the API's listing and for `/openapi.json`'s enum. */
export const CONTACTS_FORMATS = CONTACTS_IMPORTERS.map((i) => i.id);
