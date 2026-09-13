import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { loadUserConfig } from "./config";
import { normalizeCurrency } from "./currency";
import { loadEcbRates } from "./rates";
import { writeFigureDoc } from "./figures";
import type { FigureDoc } from "./api/v2/schemas/figures";
import { parseTravellers } from "./travellers/parse";
import type { Figure } from "./travellers/vocabulary";
import { writeTripFile } from "./api/v2/store";
import type { TripFile } from "./api/v2/documents";
import { LOCALE_TAG_RE } from "./locales";
import {
  ACCESSORIES,
  AGES,
  BUILDS,
  CLOTH,
  EYES,
  HAIR,
  HAIR_STYLES,
  MAX_FIGURES,
  OUTFITS,
  SKIN,
} from "./travellers/vocabulary";
import { TRACKS, parseTracks, tracksLines } from "./tracks";
import { getTrip, MAX_TRIP_PEOPLE, isPersonEmail, tripRef } from "./trips";
import { getUser } from "./users";
import { quoteScalar, singleLineProblem } from "./validate/frontmatter";

/**
 * Creating a trip.
 *
 * The other half of what an agent could not do. `create_day` has always needed
 * a trip to write into, and there was no way to make one, so an agent handed a
 * fresh journal could do precisely nothing with it.
 *
 * A trip is `trip.md` and an `entries/` folder. Everything else — costs, a
 * planned route, media — arrives later and is optional, which is why this
 * writes the smallest thing that reads back as a trip.
 */

/** Same shape a trip id has to have to be read back — `lib/trips.ts`.
 * Exported so `test/content-model.test.ts` can check `content-model.json`'s
 * `trip.md` `id` pattern against the regex that actually refuses one, rather
 * than a second copy typed out in the test. */
export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Exported for the same reason `VISIBILITIES` below is: `lib/api/openapi.ts`
 * publishes these as the enum an agent reads, and a second copy typed out
 * there would be a list that disagrees with the one that refuses. B540. */
export const ACCENTS = ["sky", "yellow", "green", "coral", "navy"] as const;
export const STATUSES = ["upcoming", "current", "past"] as const;
/** Exported so `lib/api/tripVisibility.ts` (B396) validates a later change
 * against the same list `createTrip` validates the first one against. */
export const VISIBILITIES = ["private", "public", "guest"] as const;
/** Mirrors `CostsVisibility` in lib/types.ts and `parseCostsVisibility` in
 * lib/trips.ts — the two spellings the reader understands. */
export const COSTS_VISIBILITIES = ["public", "guests"] as const;

export type NewTrip = {
  id: string;
  title: string;
  tagline?: string;
  /** Required, both of them. `readTrip` skips a trip without ISO start and
   * end dates, so a trip written without them would not merely look odd — it
   * would not exist at any reading path, silently. */
  start: string;
  end: string;
  status?: (typeof STATUSES)[number];
  accent?: (typeof ACCENTS)[number];
  visibility?: (typeof VISIBILITIES)[number];
  /**
   * Whether the trip is advertised — sitemap, feed, switcher. Only ever
   * narrows: `false` on a public trip is the old `unlisted`, and `true` on a
   * trip no visibility advertises is refused rather than written, because
   * `lib/trips.ts` would refuse it on the way back in. B51.
   */
  listed?: boolean;
  /**
   * Whether a closed trip may say that it exists — B587.
   *
   * The mirror of `listed`: only meaningful on a `guest` or `private` trip,
   * where it puts a locked card on `/<user>/trips` carrying the title, the
   * dates and nothing else. Refused on a public trip, where there is nothing
   * to tease and `listed` is the key that decides.
   */
  teaser?: boolean;
  /**
   * Who among the readers who may open the trip may see what it cost.
   *
   * `public` — the default, and what an absent key reads as — means anybody
   * who can read the trip can read its money. `guests` narrows that to
   * somebody who was on the trip or whom the owner has approved into the
   * journal (`maySeeCosts`, lib/access.ts).
   *
   * It was read, typed, gated and documented, and nothing could write it:
   * every trip on every instance had public costs and the guests-only branch
   * had nothing to act on. With no editing interface anywhere in this product
   * (ROADMAP decision 24), an owner who works through an agent could not
   * reach a feature the site says it has. B178.
   *
   * Note this is not `visibility`: it decides nothing about who may open the
   * trip, only whether the numbers are drawn once they are in.
   */
  costsVisibility?: (typeof COSTS_VISIBILITIES)[number];
  /**
   * A trip that exists to prove the software works, not to record anything.
   *
   * Every day of it gets a banner saying so, and none of it reaches the feed,
   * the search index or the sitemap. The one honest way to answer "invent me
   * three days so I can see the whole pipeline" — see lib/types.ts.
   */
  test?: boolean;
  intro?: string;
  /**
   * The three block fields, taken **raw** and validated below — B207.
   *
   * `unknown` rather than their parsed types on purpose. Each of these arrives
   * as a chunk of somebody's JSON body, and the caller is entitled to hear
   * which key of which entry is wrong; a door that coerced first would have
   * thrown that away before this function saw it. Same reasoning as
   * `costsVisibility` above, one step further: these are maps and lists, so
   * there is more to get wrong than a spelling.
   */
  /**
   * What this trip keeps track of, and therefore what every day written into
   * it is asked for — B531. Absent means all of it, which is the default an
   * owner should not have to find. Raw for the same reason the block fields
   * below are: a caller that misspelled a row is entitled to hear which.
   */
  tracks?: unknown;
  people?: unknown;
  /** How the party is drawn — see `travellersBlock`. Cosmetic, and
   *  therefore not owner-only the way `people` effectively is. */
  travellers?: unknown;
  rates?: unknown;
  translations?: unknown;
  /**
   * **`cover` is deliberately not here** — the fourth field B207 asked about,
   * and the one that answers no.
   *
   * A cover names a picture inside the trip, and at the moment this function
   * runs there is not one: the folder is being created, `media/` does not
   * exist, and `POST /api/v1/<user>/trips/<trip>/media` refuses a batch that
   * does not name a day, so the first photograph cannot arrive until a day
   * has. Anything a caller could put here would therefore point at a file that
   * is not there, and the trips index and the trip's OG image would render a
   * broken image rather than nothing — a 201 for a trip that looks worse than
   * one created without the field.
   *
   * So it stays file-only for now: `cover:` is written into `trip.md` by
   * hand, after the photographs land. The place it actually
   * belongs is a call made *after* the photographs land, which is B245.
   */
};

/**
 * A frontmatter block that validated, or the refusal to hand back.
 *
 * `lines` is markdown — kept only because it is cheap to keep and nothing
 * downstream of a successful validation needs deleting on that basis alone.
 * `value` (B1598) is the same fact as a plain JS value, for the JSON writers
 * (`createTrip` and the trip-field patchers) that build a `TripFile` rather
 * than frontmatter text. Not every block bothers: `travellersBlock` has no
 * `.value` because its caller reuses `parseTravellers` on the same
 * already-validated input instead (see there for why).
 */
export type BlockResult =
  | { ok: true; lines: string[]; value?: unknown }
  | { ok: false; error: string; message: string };

const NO_LINES: BlockResult = { ok: true, lines: [] };

/**
 * A number as YAML will read it back, or null when it would not.
 *
 * `String(1e-7)` is `"1e-7"`, which js-yaml reads as the *string* "1e-7"
 * rather than a number — YAML 1.1 wants `1.0e-07` — so a rate that small
 * would be written, parse, and then be dropped by `parseRateTable` for not
 * being a number. Refused instead: a rate nobody can see is worse than a
 * rate nobody could write.
 */
function yamlNumber(n: number): string | null {
  const s = String(n);
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

/**
 * The `people:` block — who took the trip, and therefore who may write to it.
 *
 * The one field of the four that does something beyond appearance, and the
 * reason B207 said to argue about it separately. Everyone named here may write
 * to the whole trip and may hold a token scoped to it, so accepting it is
 * accepting that an agent can say who else may write.
 *
 * Two things make that a decision rather than a hole. Creating a trip is
 * already owner-only — a trip-scoped token is refused before this runs — so
 * the authority spending itself here is the one that could already write
 * anything in the journal. And a trip made by this call is empty: the set of
 * people who can reach anything through it is exactly the set the owner just
 * named, so there is no existing content for a name to widen access *to*.
 * Naming an address grants nothing by itself either — whoever holds it still
 * has to prove it through `/api/auth/request` to get a token.
 *
 * Changing the list afterwards is the case that is not this, and there is no
 * route to it: see B245.
 *
 * **Refused, never dropped.** `parsePeople` in lib/trips.ts fails closed — one
 * bad entry drops the whole list — because a reader has nobody to tell. Here
 * somebody is listening, and a 201 for a `people:` block the site then ignores
 * is worse than a 400 naming the entry.
 */
/**
 * The `tracks:` block — what this trip is keeping, and therefore what a day
 * written into it is asked for. B531.
 *
 * **Refused, never dropped**, like every other block here: `parseTracks`
 * fails open, because a reader has nobody to tell and the safe direction
 * there is to keep asking. A *writer* is somebody listening, and a 201 for
 * `{"cost": false}` — the singular, which is the obvious typo — followed by
 * every day being refused for its costs is a worse afternoon than a 400.
 *
 * Only `false` turns a row off, and `true` is accepted and written as
 * nothing: it is the default, and a file full of `costs: true` is a file whose
 * every line has to be read to learn that it says nothing.
 */
export function tracksBlock(raw: unknown): BlockResult {
  if (raw === undefined || raw === null) return NO_LINES;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_tracks",
      message:
        'tracks must be an object, e.g. {"costs": false} — every row is on unless you turn ' +
        `it off. The rows are ${TRACKS.join(", ")}.`,
    };
  }
  const given = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(given)) {
    if (!(TRACKS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: "invalid_tracks",
        message:
          `tracks has ${JSON.stringify(key)}, which is not something a trip tracks. ` +
          `Expected: ${TRACKS.join(", ")}.`,
      };
    }
    if (typeof value !== "boolean") {
      return {
        ok: false,
        error: "invalid_tracks",
        message:
          `tracks.${key} is ${JSON.stringify(value)}; expected true or false. Only false ` +
          `turns a row off — "no" and 0 are not spellings of it, and a typo must not quietly ` +
          `stop this trip asking for its ${key}.`,
      };
    }
  }
  return { ok: true, lines: tracksLines(parseTracks(given)) };
}

/** The only keys a `people[]` entry writes. Named so the refusal below can
 * list them, the same reason `FIGURE_FIELDS` is named rather than checked
 * inline. */
const PEOPLE_FIELDS: ReadonlySet<string> = new Set(["name", "email", "nickname"]);

export function peopleBlock(raw: unknown): BlockResult {
  if (raw === undefined || raw === null) return { ok: true, lines: [], value: [] };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_people",
      message:
        'people must be a list of {"name", "email"}, e.g. ' +
        '[{"name": "Ana Meyer", "email": "ana@example.test"}]. Everyone on it may write to ' +
        "the whole trip, so it is who was there rather than who might like to read it.",
    };
  }
  if (raw.length === 0) return { ok: true, lines: [], value: [] };
  if (raw.length > MAX_TRIP_PEOPLE) {
    return {
      ok: false,
      error: "invalid_people",
      message:
        `people names ${raw.length} people; the most a trip may have is ${MAX_TRIP_PEOPLE}. ` +
        `Everyone on the list may write to the whole trip, which is why there is a ceiling — ` +
        `a list of fifty is a mailing list.`,
    };
  }

  const lines = ["people:"];
  const value: { name: string; email: string; nickname?: string }[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const at = `people[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        ok: false,
        error: "invalid_people",
        message: `${at} must be an object with a name and an email.`,
      };
    }
    const entry = item as Record<string, unknown>;

    // Refused rather than dropped, the same way `travellersBlock` refuses an
    // unknown figure field (B553): a 201 that silently threw away a key the
    // caller sent is "it was accepted" meaning something other than "it was
    // understood".
    const unknown = Object.keys(entry).filter((k) => !PEOPLE_FIELDS.has(k));
    if (unknown.length > 0) {
      return {
        ok: false,
        error: "invalid_people",
        message:
          `${at} has ${unknown.map((k) => JSON.stringify(k)).join(", ")}, which is not a ` +
          `person field. Expected: ${[...PEOPLE_FIELDS].join(", ")}.`,
      };
    }

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const email = typeof entry.email === "string" ? entry.email.trim().toLowerCase() : "";
    if (!name) {
      return { ok: false, error: "invalid_people", message: `${at}.name is required.` };
    }
    if (!isPersonEmail(email)) {
      return {
        ok: false,
        error: "invalid_people",
        message:
          `${at}.email is required and must be an address — ${JSON.stringify(entry.email ?? null)} ` +
          `is not one. It is how that person gets a token for this trip, so a placeholder ` +
          `would give them nothing.`,
      };
    }
    if (seen.has(email)) {
      return {
        ok: false,
        error: "invalid_people",
        message: `${at} lists ${email} again; each person appears once.`,
      };
    }
    seen.add(email);

    const nickname =
      entry.nickname === undefined || entry.nickname === null
        ? ""
        : typeof entry.nickname === "string"
          ? entry.nickname.trim()
          : null;
    if (nickname === null) {
      return {
        ok: false,
        error: "invalid_people",
        message: `${at}.nickname must be text — what to call them in a byline.`,
      };
    }
    for (const [field, value] of [
      [`${at}.name`, name],
      [`${at}.nickname`, nickname],
    ] as const) {
      const problem = singleLineProblem(field, value);
      if (problem) return { ok: false, error: "invalid_people", message: problem };
    }

    lines.push(`  - name: ${quoteScalar(name)}`);
    lines.push(`    email: ${quoteScalar(email)}`);
    if (nickname) lines.push(`    nickname: ${quoteScalar(nickname)}`);
    value.push({ name, email, ...(nickname ? { nickname } : {}) });
  }
  return { ok: true, lines, value };
}

/**
 * Every field a figure may carry, and what each one accepts.
 *
 * Kept as data rather than a chain of `if`s so the refusal messages can list
 * the vocabulary — an agent told "expected one of: buzz, short, tousled, …"
 * can correct itself, and one told "invalid" cannot.
 */
const FIGURE_ENUMS: ReadonlyArray<[string, readonly string[]]> = [
  ["hairStyle", HAIR_STYLES],
  ["outfit", OUTFITS],
  ["build", BUILDS],
  ["age", AGES],
];

/** Colour fields: a named token from their own table, or a hex code. */
const FIGURE_COLOURS: ReadonlyArray<[string, Record<string, string>]> = [
  ["skin", SKIN],
  ["hair", HAIR],
  ["eyes", EYES],
  ["shirt", CLOTH],
  ["pants", CLOTH],
  ["pack", CLOTH],
  ["headscarf", CLOTH],
];

/** Exported so `lib/api/openapi.ts` publishes the keys a figure may carry
 * rather than describing it as "an object". A caller that cannot see the key
 * list guesses, and `for` — an address out of `people:`, not a name — is the
 * one everybody guesses wrong. B540. */
export const FIGURE_FIELDS: ReadonlySet<string> = new Set([
  "for",
  "accessories",
  ...FIGURE_ENUMS.map(([f]) => f),
  ...FIGURE_COLOURS.map(([f]) => f),
]);

const HEX_COLOUR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The `travellers:` block — how the people on the trip are drawn.
 *
 * **Refused, never dropped**, and it is the mirror image of `parseTravellers`
 * in lib/travellers/parse.ts, which fails open. Both are right for where they
 * stand: a reader has nobody to tell, so a bad hair colour draws the default
 * and the party still appears; a *writer* is somebody listening, and a 201 for
 * a figure the site then silently reinterprets is worse than a 400 naming the
 * field. The same asymmetry as `peopleBlock` above, argued the same way.
 *
 * Unlike `people:`, nothing here decides who may write. Everything is
 * appearance, and a trip-scoped token belongs to somebody who was on the trip
 * — how they are drawn on it is theirs.
 *
 * **A starting point never reaches this function.** `resolvePreset` expands a
 * name into plain attributes at the moment somebody picks it, and only the
 * attributes are written. `preset` is refused here by name rather than
 * quietly dropped, because a caller that passed one believes it landed.
 */
export function travellersBlock(raw: unknown): BlockResult {
  if (raw === undefined || raw === null) return NO_LINES;
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_travellers",
      message:
        "travellers must be a list of figures, e.g. " +
        '[{"skin": "medium", "hair": "black", "hairStyle": "coils"}]. ' +
        "GET /api/v2/<user>/figures/presets lists every word this takes.",
    };
  }
  if (raw.length === 0) return NO_LINES;
  if (raw.length > MAX_FIGURES) {
    return {
      ok: false,
      error: "invalid_travellers",
      message:
        `travellers draws ${raw.length} figures; the most a trip may have is ${MAX_FIGURES}. ` +
        "Past that it is a crowd scene rather than a party, and it does not fit a hero.",
    };
  }

  const lines = ["travellers:"];
  for (const [index, item] of raw.entries()) {
    const at = `travellers[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        ok: false,
        error: "invalid_travellers",
        message: `${at} must be an object describing one figure.`,
      };
    }
    const entry = item as Record<string, unknown>;

    const unknown = Object.keys(entry).filter((k) => !FIGURE_FIELDS.has(k));
    if (unknown.length > 0) {
      return {
        ok: false,
        error: "invalid_travellers",
        message: unknown.includes("preset")
          ? `${at}.preset is not written to disk. Resolve a starting point into its ` +
            `attributes first — GET /api/v2/<user>/figures/presets returns them — so the ` +
            `file records a hair colour rather than a claim about somebody's background.`
          : `${at} has ${unknown.map((k) => JSON.stringify(k)).join(", ")}, which is not a ` +
            `figure field. Expected: ${[...FIGURE_FIELDS].join(", ")}.`,
      };
    }

    const out: string[] = [];

    const forWhom = entry.for;
    if (forWhom !== undefined && forWhom !== null) {
      const email = typeof forWhom === "string" ? forWhom.trim().toLowerCase() : "";
      if (!isPersonEmail(email)) {
        return {
          ok: false,
          error: "invalid_travellers",
          message:
            `${at}.for is ${JSON.stringify(forWhom)}; it ties this figure to an address in ` +
            `people:, so it has to be one.`,
        };
      }
      out.push(`for: ${quoteScalar(email)}`);
    }

    for (const [field, table] of FIGURE_COLOURS) {
      const value = entry[field];
      if (value === undefined || value === null) continue;
      const ok =
        typeof value === "string" &&
        (HEX_COLOUR_RE.test(value) ||
          value in table ||
          (field === "pack" && value === "none"));
      if (!ok) {
        return {
          ok: false,
          error: "invalid_travellers",
          message:
            `${at}.${field} is ${JSON.stringify(value)}; expected a hex colour like ` +
            `"#8b5630"${field === "pack" ? `, "none",` : ","} or one of: ` +
            `${Object.keys(table).join(", ")}.`,
        };
      }
      out.push(`${field}: ${quoteScalar(value)}`);
    }

    for (const [field, allowed] of FIGURE_ENUMS) {
      const value = entry[field];
      if (value === undefined || value === null) continue;
      if (typeof value !== "string" || !allowed.includes(value)) {
        return {
          ok: false,
          error: "invalid_travellers",
          message:
            `${at}.${field} is ${JSON.stringify(value)}; expected one of: ${allowed.join(", ")}.`,
        };
      }
      // Written unquoted, matching `status:` and `accent:` above — and safe
      // only because `allowed` is a fixed list checked one line up. Widen one
      // of those lists to anything free-form without quoting here and this
      // becomes YAML injection into somebody's trip.md.
      out.push(`${field}: ${value}`);
    }

    const accessories = entry.accessories;
    if (accessories !== undefined && accessories !== null) {
      if (!Array.isArray(accessories)) {
        return {
          ok: false,
          error: "invalid_travellers",
          message: `${at}.accessories must be a list, e.g. ["glasses", "hat"].`,
        };
      }
      for (const one of accessories) {
        if (typeof one !== "string" || !(ACCESSORIES as readonly string[]).includes(one)) {
          return {
            ok: false,
            error: "invalid_travellers",
            message:
              `${at}.accessories has ${JSON.stringify(one)}; expected one of: ` +
              `${ACCESSORIES.join(", ")}.`,
          };
        }
      }
      if (accessories.length > 0) out.push(`accessories: [${accessories.join(", ")}]`);
    }

    if (out.length === 0) {
      // An empty figure means the neutral default, which is what an absent
      // entry already means — but a party of three where the middle one is
      // unspecified still needs a slot, so it gets one.
      lines.push("  - {}");
    } else {
      lines.push(`  - ${out[0]}`, ...out.slice(1).map((line) => `    ${line}`));
    }
  }
  return { ok: true, lines };
}

/**
 * The `rates:` block — this trip's frozen local→base table.
 *
 * Accepted because there is nothing about it that has to wait: the number is a
 * judgement about what the trip actually cost (B17), and whoever is writing up
 * the trip either already holds it or does not. Without it every foreign cost
 * in the trip reads as unconverted, which the costs page says out loud and
 * which nobody could fix from outside the server.
 *
 * The direction is the one that is easy to get backwards, so the doors say it
 * in words: **units of the journal's base currency for one unit of the keyed
 * currency**, `THB: 0.0245` being "1 THB = 0.0245 CHF". The ECB table in
 * `<DATA_DIR>/rates/ecb.json` points the other way. `docs/currencies.md` carries
 * the comparison and the rule of thumb — a currency worth less than the base
 * one has a small number.
 */
export function ratesBlock(raw: unknown): BlockResult {
  if (raw === undefined || raw === null) return { ok: true, lines: [], value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_rates",
      message:
        'rates must be an object of currency code to number, e.g. {"THB": 0.0245} — units of ' +
        "the journal's base currency for one unit of the keyed currency.",
    };
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return { ok: true, lines: [], value: {} };

  const lines = ["rates:"];
  /** code → units of the journal's base currency for one unit of that
   * currency — v1's own convention, unchanged. The v2 `manual` map wants the
   * opposite direction (units per 1 EUR); `eurManualRates` below is where
   * that conversion happens, at the one call site that knows the base. */
  const value: Record<string, number> = {};
  for (const [key, rawValue] of entries) {
    const code = normalizeCurrency(key);
    if (!code) {
      return {
        ok: false,
        error: "invalid_rates",
        message: `rates has key "${key}"; each key is a three-letter currency code, like "THB".`,
      };
    }
    const n = typeof rawValue === "string" ? Number(rawValue) : rawValue;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        error: "invalid_rates",
        message:
          `rates.${code} must be a positive number, got ${JSON.stringify(rawValue)}. It is how ` +
          `many units of the base currency one ${code} was worth on this trip — 0.0245, not 40.8, ` +
          `for a currency worth less than the base one.`,
      };
    }
    const written = yamlNumber(n);
    if (!written) {
      return {
        ok: false,
        error: "invalid_rates",
        message:
          `rates.${code} is ${JSON.stringify(rawValue)}, which can only be written in exponent ` +
          `form — and the file would then read it back as text rather than as a rate. Write it ` +
          `as a plain decimal, or key the table by the larger unit.`,
      };
    }
    lines.push(`  ${code}: ${written}`);
    value[code] = n;
  }
  return { ok: true, lines, value };
}

/**
 * v1's `rates: {code: base-per-code}` → v2's `rates.manual: {code:
 * eur-per-code}` — the ECB table's own convention (B1598 finding: the two
 * schemas name the same fact in opposite directions).
 *
 * `baseEur` is how many units of the journal's base currency one EUR buys.
 * When the base itself is not in the ECB table (an uncommon base currency
 * the archive does not track), there is no honest conversion to make from
 * inside this function — the caller is treated as though the base were EUR,
 * which is exact only in that case and an approximation otherwise.
 *
 * **A rate for "EUR" itself needs its own case** (a second B1598 finding,
 * caught only once this was tested against real numbers): `crossRate`
 * (lib/currency.ts) always resolves the currency literally named `"EUR"` to
 * `1` on the side being converted *from*, whatever `manual.EUR` says — that
 * is what makes EUR the table's fixed reference point in the first place.
 * So `manual.EUR` is not merely unnecessary, it is **unreachable**: nothing
 * ever reads it back. The only way to express "this trip's own EUR rate
 * against its base" is to override the *base* currency's own entry instead
 * — `manual[baseCode]` — since every other conversion already divides
 * through exactly that number. Once it is set, every other code's own
 * `manual` entry has to be computed from the same overridden `baseEur`
 * rather than from the ECB's raw figure, or the two would disagree about
 * what a euro is worth on this trip.
 *
 * ponytail: an approximation rather than a refusal when the base itself is
 * untracked, so a trip whose base currency the ECB does not track still
 * gets *a* number instead of a failed create. Upgrade path: refuse instead,
 * once an owner actually hits this.
 */
export function eurManualRates(
  baseCode: string,
  rates: Record<string, number>,
): Record<string, number> | undefined {
  if (Object.keys(rates).length === 0) return undefined;
  const ecb = loadEcbRates()?.rates;
  let baseEur = baseCode === "EUR" ? 1 : ecb?.[baseCode];
  const manual: Record<string, number> = {};
  if (baseCode !== "EUR" && rates.EUR !== undefined) {
    baseEur = rates.EUR;
    manual[baseCode] = rates.EUR;
  }
  for (const [code, basePerCode] of Object.entries(rates)) {
    if (code === "EUR") continue; // handled above — see the docblock
    manual[code] = (baseEur ?? 1) / basePerCode;
  }
  return Object.keys(manual).length ? manual : undefined;
}

/**
 * The `translations:` block — the trip's title, tagline and introduction in
 * the journal's other languages.
 *
 * Refused for a locale the journal does not declare, rather than written. A
 * translation into a language nothing renders is exactly the inert write B182
 * would not ship: it lands, it reads back, and no reader ever sees it. Since
 * B220 the journal's `locales` are themselves reachable, so the refusal names
 * the call that fixes it instead of ending the conversation.
 *
 * Exported since B1496 so `patchTripDetails` corrects the block with the same
 * serialiser that wrote it, rather than a second one that would drift: the
 * whole point of that ticket is that a typo in a German title was permanent,
 * and a correction written by different code from the create is the next
 * version of the same bug.
 */
export function translationsBlock(raw: unknown, locales: string[]): BlockResult {
  if (raw === undefined || raw === null) return { ok: true, lines: [], value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_translations",
      message:
        'translations must be an object keyed by locale, e.g. ' +
        '{"de": {"title": "Japan", "tagline": "Sechs Wochen mit dem Zug", "intro": "…"}}.',
    };
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return { ok: true, lines: [], value: {} };

  const lines = ["translations:"];
  const value: Record<string, { title?: string; tagline?: string; intro?: string }> = {};
  for (const [locale, rawEntry] of entries) {
    if (!LOCALE_TAG_RE.test(locale)) {
      return {
        ok: false,
        error: "invalid_translations",
        message: `translations has key "${locale}"; each key is a language code, like "de".`,
      };
    }
    if (!locales.includes(locale)) {
      return {
        ok: false,
        error: "invalid_translations",
        message:
          `This journal does not speak "${locale}" — it declares ${locales.map((l) => `"${l}"`).join(", ")} ` +
          `— so a translation into it would be written and never rendered. Add the language ` +
          `first with PATCH /api/v1/<user>/config {"locales": [...]}, or leave it out.`,
      };
    }
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      return {
        ok: false,
        error: "invalid_translations",
        message: `translations.${locale} must be an object with a title, a tagline, an intro, or a combination of them.`,
      };
    }
    const entry = rawEntry as Record<string, unknown>;
    const out: string[] = [];
    const entryValue: { title?: string; tagline?: string; intro?: string } = {};
    for (const field of ["title", "tagline", "intro"] as const) {
      const v = entry[field];
      if (v === undefined || v === null) continue;
      if (typeof v !== "string") {
        return {
          ok: false,
          error: "invalid_translations",
          message: `translations.${locale}.${field} must be text.`,
        };
      }
      const trimmed = v.trim();
      if (!trimmed) continue;
      if (field !== "intro") {
        const problem = singleLineProblem(`translations.${locale}.${field}`, trimmed);
        if (problem) return { ok: false, error: "invalid_translations", message: problem };
      }
      out.push(`    ${field}: ${quoteScalar(trimmed)}`);
      entryValue[field] = trimmed;
    }
    if (out.length === 0) {
      return {
        ok: false,
        error: "invalid_translations",
        message:
          `translations.${locale} says nothing — give it a title, a tagline, an intro, or a combination. The ` +
          `reader drops an empty one, so writing it would look like it took.`,
      };
    }
    lines.push(`  ${locale}:`, ...out);
    value[locale] = entryValue;
  }
  return { ok: true, lines, value };
}

export type CreateTripResult =
  | { ok: true; id: string; ref: string }
  | { ok: false; error: string; message: string };

/** Exported for the same reason `ID_RE` above is — `test/content-model.test.ts`
 * checks `content-model.json`'s `start`/`end` pattern against this. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * v1's inline `travellers:` attribute list → v2's `figures:` reference into
 * the journal's own figure library — B1598 finding (see the "Found
 * 2026-09-13" section of the migration ticket): the two schemas describe a
 * party in genuinely different ways, not just under different names. v1
 * described each figure's attributes inline, per trip; v2 names a *mode* and,
 * for a custom party, a list of ids into `content/<user>/figures/<id>.json`
 * (`lib/figures.ts`, B1609) — a figure is drawn the same on every trip that
 * references it rather than re-described each time.
 *
 * So an old-shape `travellers:` list is provisioned into the library here,
 * under stable, trip-scoped ids, rather than dropped or half-represented.
 * `travellersBlock` has already refused anything `parseTravellers` would
 * otherwise have to drop, so reusing it on the same, now-validated input is
 * exactly the same shape `lib/journals.ts` already relies on for the
 * journal-level default party.
 *
 * ponytail: ids are regenerated deterministically (`<tripId>-traveller-<n>`)
 * on every write rather than reused/diffed against what the library already
 * holds, so a shorter list on a later edit leaves the trailing figure files
 * on disk, unreferenced. Nothing else in the journal can reach them by name,
 * and cleaning them up is a `lib/figures.ts` upgrade if it is ever worth
 * doing, not something a trip writer should carry.
 */
export function writeTravellersAsFigures(
  username: string,
  tripId: string,
  raw: unknown,
): TripFile["figures"] | undefined {
  const figures = parseTravellers(raw, `${username}/trips/${tripId}`);
  if (figures.length === 0) return undefined;
  const ids = figures.map((figure, index) => {
    const id = `${tripId}-traveller-${index + 1}`;
    writeFigureDoc(username, figureDocFrom(id, figure));
    return id;
  });
  return { mode: "custom", figures: ids };
}

/** A render-layer `Figure` (lib/travellers/vocabulary.ts) → a library
 * `FigureDoc` (lib/api/v2/schemas/figures.ts) — the field names already
 * match one to one; only `for` (an address into `people:`) is renamed to
 * `person`, the figure library's own word for the same fact. */
function figureDocFrom(id: string, figure: Figure): FigureDoc {
  return {
    id,
    ...(figure.for ? { person: figure.for } : {}),
    ...(figure.hairStyle ? { hairStyle: figure.hairStyle } : {}),
    ...(figure.outfit ? { outfit: figure.outfit } : {}),
    ...(figure.build ? { build: figure.build } : {}),
    ...(figure.age ? { age: figure.age } : {}),
    ...(figure.skin ? { skin: figure.skin } : {}),
    ...(figure.hair ? { hair: figure.hair } : {}),
    ...(figure.eyes ? { eyes: figure.eyes } : {}),
    ...(figure.shirt ? { shirt: figure.shirt } : {}),
    ...(figure.pants ? { pants: figure.pants } : {}),
    ...(figure.pack ? { pack: figure.pack } : {}),
    ...(figure.headscarf ? { headscarf: figure.headscarf } : {}),
    ...(figure.accessories?.length ? { accessories: figure.accessories } : {}),
  };
}

export function createTrip(username: string, input: NewTrip): CreateTripResult {
  const user = getUser(username);
  if (!user) {
    return { ok: false, error: "no_such_journal", message: `No journal called "${username}".` };
  }

  const id = input.id.trim().toLowerCase();
  if (!ID_RE.test(id)) {
    return {
      ok: false,
      error: "invalid_trip_id",
      message:
        "A trip id is lowercase letters, digits and dashes, starting with a letter or digit. " +
        "It becomes part of the URL, so `japan-2027` ages better than `the-big-one`.",
    };
  }

  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: "invalid_title", message: "A trip needs a title." };
  }

  /**
   * The two fields that become a quoted scalar on one line of the frontmatter,
   * refused here rather than escaped away. B204.
   *
   * `quoteScalar` would now write `\n` and the file would parse, so this is
   * not what stops the folder being bricked — it is what stops the caller
   * being told 201 for a title it did not ask for. A trip called
   * "Japan\n---\nnot: [yaml" is nobody's trip title, and naming the field is
   * an error an agent can act on.
   *
   * `intro` is deliberately absent: it is prose below the closing `---` and
   * multiple lines are the point.
   */
  for (const [field, value] of [
    ["title", title],
    ["tagline", input.tagline?.trim() ?? ""],
  ] as const) {
    const problem = singleLineProblem(field, value);
    if (problem) {
      return { ok: false, error: `invalid_${field}`, message: problem };
    }
  }

  for (const [field, value] of [
    ["start", input.start],
    ["end", input.end],
  ] as const) {
    if (!value || !DATE_RE.test(value)) {
      return {
        ok: false,
        error: "invalid_date",
        message:
          `${field} is required and must be a date like 2027-04-01. A trip without both ` +
          `dates is skipped when the site reads it, so it would exist on disk and nowhere else.`,
      };
    }
  }
  if (input.end < input.start) {
    return {
      ok: false,
      error: "invalid_date",
      message: `end (${input.end}) is before start (${input.start}).`,
    };
  }

  const dir = path.join(contentRoot(), username, "trips", id);
  if (fs.existsSync(dir)) {
    return {
      ok: false,
      error: "trip_exists",
      message: `"${username}" already has a trip called "${id}".`,
    };
  }

  // v2 stores no `status` at all — every read derives past/upcoming/current
  // from the dates (`calendarStatus`, lib/tripTime.ts), so `input.status`,
  // once written as a snapshot that could contradict its own dates (B72), is
  // now accepted and quietly ignored rather than round-tripped.
  /**
   * Written only when the caller named one — B346, and the same rule
   * `listed:` already follows below.
   *
   * It used to default to `"sky"` and write that line unconditionally, which
   * put a colour nobody had chosen into every scaffolded trip and made "no
   * preference" unrepresentable: the trips page could not assign distinct
   * colours without trampling deliberate ones. Silence here is what lets it.
   */
  const accent = ACCENTS.includes(input.accent as never) ? input.accent! : undefined;
  /**
   * Silence and a typo are answered differently, and only one of them may
   * ever come out more open than the journal itself is — B306.
   *
   * Omitting the field inherits the journal's own answer: a `guest` journal
   * makes `guest` trips, a `public` one makes `public` trips, unless this
   * call says otherwise. That is a deliberate change from "always private" —
   * the owner who set their journal to `public` has already said they want
   * things found, and a trip silently held back from that is its own kind of
   * surprise (the mirror image of B263). A *typo*, though, is not silence and
   * gets no such benefit: `lib/trips.ts` already reads an unrecognised
   * visibility as `private` so that a misspelling cannot publish somebody's
   * trip, and this falls back the same way — never to the journal's default,
   * which could be `public`.
   */
  const visibility = VISIBILITIES.includes(input.visibility as never)
    ? input.visibility!
    : input.visibility === undefined
      ? (user.visibility === "guest" ? "guest" : "public")
      : "private";

  /**
   * An unrecognised `costsVisibility` is **refused, not defaulted** — the one
   * place in this function where a typo does not fall back to a default, and
   * for the same reason `visibility` does fall back to `private`.
   *
   * The safe end of this axis is `guests`, and that is what the reader picks
   * for a value it does not know (`parseCostsVisibility`, lib/trips.ts).
   * Defaulting a misspelling to `public` here would therefore both widen what
   * the caller asked for and disagree with the reader about the same file.
   * Defaulting it to `guests` would hide the money of every caller who typed
   * "publik". Neither is a thing to do silently to somebody's trip, so the
   * caller hears about it instead.
   */
  const costsVisibility = input.costsVisibility;
  if (costsVisibility !== undefined && !COSTS_VISIBILITIES.includes(costsVisibility)) {
    return {
      ok: false,
      error: "invalid_costs_visibility",
      message:
        `costsVisibility "${costsVisibility}" is not a value this reads. It is ` +
        `"public" — anybody who can open the trip sees what it cost — or "guests", which ` +
        `narrows the numbers to the people who were on the trip and the readers you have ` +
        `approved into the journal. It does not decide who may open the trip; visibility does.`,
    };
  }

  /**
   * `listed` and `test` are booleans, and only the JSON booleans count — B540.
   *
   * Both used to be read with `=== true` / `=== false`, which is careful about
   * what counts as *true* but says nothing about what counts as *neither*: a
   * caller sending the string `"false"` is not `=== false`, so it fell through
   * every branch below as if the field had never been mentioned, and an absent
   * `listed` on a public trip reads back as `listed: true` — the opposite of
   * what a string-typed serialiser plausibly meant to ask for. `checkTest` in
   * lib/validate/entry.ts takes the same line for the day-level `test` field:
   * a non-boolean is refused, not treated as absent, because a caller who sent
   * *something* is entitled to hear that it did not land, rather than having
   * the request quietly reinterpreted as one it did not make.
   */
  // The code is written out rather than built from the field name: the error
  // vocabulary is published (lib/api/errorCodes.ts) and checked by searching
  // for it, and a code that only exists as a template is one no search finds.
  for (const [field, value, code] of [
    ["listed", input.listed, "invalid_listed"],
    ["teaser", input.teaser, "invalid_teaser"],
    ["test", input.test, "invalid_test"],
  ] as const) {
    if (value !== undefined && typeof value !== "boolean") {
      return {
        ok: false,
        error: code,
        message:
          `${field} is ${JSON.stringify(value)}; expected true or false — the JSON booleans, ` +
          `not the strings. A typo here must not be read as "not mentioned".`,
      };
    }
  }

  /**
   * `listed: true` on a trip nothing advertises is a request the reader will
   * refuse, so refuse it here where somebody is listening.
   *
   * The alternative — write it anyway — is B51 again: the file would say one
   * thing, `lib/trips.ts` would read another, and the caller would be told 201.
   * Saying so costs one error and teaches the axis; only `public` advertises.
   */
  if (input.listed === true && visibility !== "public") {
    return {
      ok: false,
      error: "invalid_listed",
      message:
        `listed: true asks for the trip to be advertised — in the sitemap, the feed and the ` +
        `trip switcher — but visibility "${visibility}" does not put it in front of anybody. ` +
        `Only a public trip is advertised. Drop listed, or set visibility to "public".`,
    };
  }

  /**
   * And its mirror: `teaser: true` on a public trip is a request nothing can
   * carry out, so it is refused rather than written for `lib/trips.ts` to drop
   * on the way back in. B587.
   */
  if (input.teaser === true && visibility === "public") {
    return {
      ok: false,
      error: "invalid_teaser",
      message:
        `teaser: true asks for a closed trip to be named on the trips page without being ` +
        `readable, but visibility "${visibility}" already opens the whole trip to anybody. ` +
        `Drop teaser, or set visibility to "guest" or "private".`,
    };
  }

  /**
   * The three block fields, all validated before anything is on disk — B207.
   *
   * Deliberately before the `mkdirSync` below rather than woven into the
   * frontmatter array: a refusal that has already made the folder is the B204
   * failure again, and these are the fields with the most ways to be wrong.
   */
  const peopleResult = peopleBlock(input.people);
  const ratesResult = ratesBlock(input.rates);
  const translationsResult = translationsBlock(input.translations, user.locales);
  // `travellersBlock` and `tracksBlock` still validate — an agent sending a
  // malformed figure or an unknown track name is refused exactly as before —
  // but neither's `.lines` is written: travellers become figure-library
  // entries below, and tracks have no v2 home at all any more (every day
  // answers every declinable directly — see `lib/trips.ts`'s own note).
  for (const block of [
    peopleResult,
    travellersBlock(input.travellers),
    ratesResult,
    translationsResult,
    tracksBlock(input.tracks),
  ]) {
    if (!block.ok) return { ok: false, error: block.error, message: block.message };
  }

  const baseCurrency = normalizeCurrency(
    loadUserConfig(username).baseCurrency,
    loadUserConfig(username).baseCurrency.toUpperCase(),
  );
  const rates = ratesResult.value as Record<string, number>;
  const manualRates = eurManualRates(baseCurrency, rates);

  const trip: TripFile = {
    id,
    title,
    ...(input.tagline?.trim() ? { tagline: input.tagline.trim() } : {}),
    dates: { from: input.start, to: input.end },
    visibility,
    people: peopleResult.value as TripFile["people"],
    ...(input.listed === false ? { listed: false } : {}),
    ...(input.teaser === true ? { teaser: true } : {}),
    ...(input.test === true ? { test: true } : {}),
    ...(accent ? { accent } : {}),
    // `currencies` names what a cost may actually be spent in — the v1-style
    // codes the caller sent (`rates`'s own keys) — not `manualRates`'s own
    // keys, which for a declared EUR rate is the trip's base currency
    // instead (see `eurManualRates`'s docblock).
    ...(manualRates ? { rates: { currencies: Object.keys(rates), manual: manualRates } } : {}),
    // v2's `costs` section normally requires a `budget` (B1597) — this v1
    // door has never asked for one, so a caller narrowing visibility here
    // gets exactly that key and nothing invented beside it. The cast is
    // honest about the gap: `lib/trips.ts`'s reader only ever looks at
    // `costs?.visibility`, tolerant of a missing budget, the same way it is
    // tolerant of a missing `costs` section at all.
    ...(costsVisibility === "guests" ? { costs: { visibility: "guests" } as TripFile["costs"] } : {}),
    ...(Object.keys(translationsResult.value as object).length
      ? { translations: translationsResult.value as TripFile["translations"] }
      : {}),
    ...(input.intro?.trim() ? { intro: input.intro.trim() } : {}),
    ...(() => {
      const figures = writeTravellersAsFigures(username, id, input.travellers);
      return figures ? { figures } : {};
    })(),
  };

  fs.mkdirSync(path.join(dir, "entries"), { recursive: true });
  writeTripFile(username, id, trip);

  // No cache to clear: `getTrips` fingerprints the trip folders with a stat
  // per trip and re-reads when that changes, so a new folder is picked up on
  // the next call by itself.

  // Read it back rather than trusting the write: a trip that does not parse is
  // invisible at every reading path, and the caller should hear that now
  // rather than discover an empty journal later.
  const ref = tripRef(username, id);
  if (!getTrip(ref)) {
    /**
     * Roll back, because a refusal that leaves the folder behind is worse
     * than the write it refused. B204.
     *
     * The folder is invisible at every reading path — that is what "does not
     * read back" means — and every delete path resolves the trip first, so
     * nothing in the product could remove it afterwards. The id was consumed
     * for good and the only cure was a shell on the server.
     *
     * Safe to remove because of the `existsSync` guard above: this function
     * returns `trip_exists` when the directory is already there, so by the
     * time control reaches here the folder is one this call made and holds
     * nothing but the `trip.md` and empty `entries/` written six lines up.
     */
    let removed = true;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      removed = false;
    }
    return {
      ok: false,
      error: "trip_unreadable",
      message:
        "The trip was written but does not read back, so it was removed again" +
        (removed
          ? ` and the id "${id}" is still free.`
          : ` — but the folder could not be cleaned up, so "${id}" is taken until somebody removes it on the server.`) +
        " This is a bug; please report it.",
    };
  }

  return { ok: true, id, ref };
}
