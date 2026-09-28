// lib/localeScopes.paid.json — gitignored, regenerated at the start of every
// `next build`/`next dev` (called from next.config.ts, so both hit it) when a
// real `paid/` checkout sits beside this one. B2551.
//
// The committed lib/localeScopes.json resolves `@paid/*` to the stubs under
// lib/paid-stubs/, which render nothing — so a scope reaching one can only
// record *that* it does (its `paid` list) and `dictionaryFor` ships the whole
// dictionary rather than guess which keys the real paid/ pages use. With a
// real `paid/` present, this file is a second computation of the same scopes
// resolving `@paid/*` to those real files instead, so the key list is the
// truth: a hosted build's `/` ships root's few hundred keys, not the whole
// ~4,500-key dictionary, the same as the open edition always has.
//
// Absent on a plain clone, and removed here if a `paid/` checkout that was
// mounted goes away again — `lib/locales.ts`'s `dictionaryFor` falls back to
// the committed scopes exactly as before this file existed.
import fs from "node:fs";
import path from "node:path";
import { computeLocaleScopes, formatLocaleScopes } from "./locale-scopes-lib.mjs";

export function syncPaidLocaleScopes(root) {
  const paidDir = path.join(root, "paid");
  const outFile = path.join(root, "lib", "localeScopes.paid.json");
  // Never fatal: next.config.ts runs this on `next start` as well, where the
  // service user may not own lib/ (the build ran as someone else). The file
  // the build wrote stays in place, and with none at all `dictionaryFor`
  // ships whole dictionaries as before B2551 — slower, never broken.
  try {
    if (!fs.existsSync(path.join(paidDir, "manifest.ts"))) {
      fs.rmSync(outFile, { force: true });
      return;
    }
    const scopes = computeLocaleScopes(root, undefined, { paidRoot: paidDir });
    fs.writeFileSync(outFile, formatLocaleScopes(scopes));
  } catch (error) {
    console.warn(`lib/localeScopes.paid.json not refreshed: ${error instanceof Error ? error.message : error}`);
  }
}
