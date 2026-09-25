import type { Caller } from "@/lib/helper/caller";

/**
 * The caller most of this suite's `runTool` calls mean — an already-
 * authenticated owner at the web door, the same shape `resolveCookieCaller`
 * mints for a real browser session — B1891.
 *
 * `runTool` now fails closed on the caller it is given: an absent, unknown
 * or malformed one gets the WhatsApp-narrow allowance
 * (`lib/helper/tools/run.ts`), not the whole registry. Every test in this
 * file that exercises a tool outside that narrow set is a web scenario, so
 * it says so explicitly with this rather than relying on a default that no
 * longer means "everything".
 */
export const WEB_CALLER: Caller = { username: "test-web-caller", how: "cookie" };

/** The narrower one, named for the tests that want it on purpose. */
export const WHATSAPP_CALLER: Caller = { username: "test-whatsapp-caller", how: "whatsapp" };
