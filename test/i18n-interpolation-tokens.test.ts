import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B1957 — "ten translated strings carry an interpolation token their
 * English original does not". Investigated with the renderer's own token
 * regex (`translate`, lib/i18n.ts: `/\{(\w+)\}/g`) across every key shared
 * between `en.json` and `de.json`/`hu.json`.
 *
 * What that scan actually found, against `main` before this ticket: eight
 * keys, not ten, every one of them a `.one` variant — seven `studio.photos.*`
 * keys plus `me.paymentBalance.one` — where Hungarian's singular carries the
 * same `{count}`/`{balance}` token the plural form has, while English and
 * German hardcode the number ("1 done" / "1 Änderung speichern") instead.
 *
 * `plural()`'s own doc comment (lib/i18n.ts) already documents why: a
 * language that does not inflect after a number, like Hungarian, simply
 * repeats the same word in its `.one` entry as its plural — keeping the
 * token there is correct, not a leftover. The seven `studio.photos.*` call
 * sites (`UploadStep.tsx`, `DayBoard.tsx`, `FoundStep.tsx`,
 * `ResumeScreen.tsx`) all pass `{ count: String(n) }` into `tn()` regardless
 * of `n`, so the renderer really does substitute that token for the `.one`
 * variant — nothing renders a literal `{count}` to a reader. Confirmed by
 * grepping every one of those seven call sites for a `count:` var, not by
 * assumption.
 *
 * `me.paymentBalance` (base and `.one`) is not called by `t()`/`tn()`
 * anywhere in the app (`me.paymentBalanceEmpty` is the only one actually
 * wired up in `AccountPageContent.tsx`) — dead, not a live mismatch either
 * way. Left alone here; worth its own "unused translation key" ticket,
 * which is a different defect than this one.
 *
 * So: no live "renders a literal brace" bug existed to fix. What this test
 * fixes into place is the one direction that WOULD be a real bug — a
 * translation *dropping* a token English has, which always renders a
 * reader-visible gap (`vars[name] ?? match` leaves nothing in its place for
 * the missing var) — asserted against every key both locales share, not
 * only the eight found here, so it also catches whatever the next round of
 * translations gets wrong.
 */

const ROOT = path.join(import.meta.dirname, "..");

function tokens(value: string): Set<string> {
  return new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

function locale(name: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "site", "locales", `${name}.json`), "utf8")) as Record<
    string,
    string
  >;
}

const en = locale("en");

describe("No translation drops an interpolation token English has — B1957", () => {
  for (const code of ["de", "hu", "fr", "it"] as const) {
    test(code, () => {
      const dict = locale(code);
      const dropped: { key: string; missing: string[] }[] = [];
      for (const [key, enValue] of Object.entries(en)) {
        if (!(key in dict)) continue;
        const enTokens = tokens(enValue);
        const theirTokens = tokens(dict[key]);
        const missing = [...enTokens].filter((t) => !theirTokens.has(t));
        if (missing.length > 0) dropped.push({ key, missing });
      }
      expect(dropped, `${code}.json drops a token English's own string has`).toEqual([]);
    });
  }

  // The eight known-fine "extra token" cases stay documented and pinned:
  // if a translation adds a var, the exact call sites that feed it a value
  // for every count are enumerated above, and this list is what stops a
  // ninth showing up unnoticed.
  test("the .one keys carrying an extra token beyond English are exactly the known, call-site-verified set", () => {
    const de = locale("de");
    const hu = locale("hu");
    const extra: string[] = [];
    for (const [key, enValue] of Object.entries(en)) {
      const enTokens = tokens(enValue);
      for (const [code, dict] of [["de", de], ["hu", hu]] as const) {
        if (!(key in dict)) continue;
        const theirTokens = tokens(dict[key]);
        const added = [...theirTokens].filter((t) => !enTokens.has(t));
        if (added.length > 0) extra.push(`${key} (${code})`);
      }
    }
    expect(extra.sort()).toEqual(
      [
        "edit.confirmSave.button.one (hu)", // B1880 — added in this same run, same convention.
        "me.paymentBalance.one (hu)", // dead key, never rendered either way.
        "studio.photos.board.photoCount.one (hu)",
        "studio.photos.board.summary.noPlace.one (hu)",
        "studio.photos.board.summary.withPlace.one (hu)",
        "studio.photos.resume.daysLeft.one (hu)",
        "studio.photos.upload.chips.done.one (hu)",
        "studio.photos.upload.chips.etaMinutes.one (hu)",
        "studio.photos.upload.failurePanel.title.one (hu)",
      ].sort(),
    );
  });
});
