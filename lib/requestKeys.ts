/**
 * The two names the proxy and the pages have to agree on.
 *
 * They lived in `proxy.ts` next to the code that sets them, which reads better
 * and cost a production build: `components/LocaleSwitcher.tsx` is a client
 * component and imported `LOCALE_COOKIE` from there, so **everything
 * `proxy.ts` imports was pulled into the browser bundle**. That was invisible
 * while the proxy imported nothing, and became a build failure the moment it
 * needed to read a file (`the chunking context does not support external
 * modules (request: node:fs)`, while chunking `/page`).
 *
 * So the constants live here, in a module with no imports at all, and
 * `proxy.ts` is free to reach the filesystem. Anything else two sides of that
 * boundary need to share belongs here too — not in `proxy.ts`.
 */

/** The language a reader picked, set by `?lang=` in the proxy. */
export const LOCALE_COOKIE = "fs.locale";

/** The request path, carried to the root layout — `headers()` is readable in
 * a layout and the pathname is not. */
export const PATH_HEADER = "x-fernscout-path";
