import path from "node:path";

/**
 * Where the *instance* lives, as opposed to where the journals live.
 *
 * `site/` holds the four things `content/` used to hold that are not a
 * person: the server's `config.json`, the UI dictionaries, the ECB reference
 * rates, and this instance's legal page. They have nothing in common with a
 * journal except that they were once neighbours, and that accident cost a
 * copying script, a denylist and B56 — the live site served August's German
 * for a month because a deploy updates the repository and the app reads
 * `CONTENT_DIR`.
 *
 * Here, it does not: `site/` is inside the checkout, so `git pull` *is* the
 * update. Nothing copies anything.
 *
 * Read on every call rather than captured once, for the same reason
 * `contentRoot()` is. `SITE_DIR` overrides it, which is for a packaging
 * layout where the checkout is not the working directory; an instance
 * wanting its own dictionaries or its own imprint overrides those
 * individually under `CONTENT_DIR` (see `lib/locales.ts` and `lib/legal.ts`).
 */
export function siteRoot(): string {
  return process.env.SITE_DIR ?? path.join(process.cwd(), "site");
}
