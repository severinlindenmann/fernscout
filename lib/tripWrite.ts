import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { normalizeCurrency } from "./currency";
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
  SKIN,
} from "./travellers/vocabulary";
import { getTrip, MAX_TRIP_PEOPLE, PERSON_EMAIL_RE, tripRef } from "./trips";
import { calendarStatus } from "./tripTime";
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

/** Same shape a trip id has to have to be read back — `lib/trips.ts`. */
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const ACCENTS = ["sky", "yellow", "green", "coral", "navy"] as const;
const STATUSES = ["upcoming", "current", "past"] as const;
/** Exported so `lib/api/tripVisibility.ts` (B396) validates a later change
 * against the same list `createTrip` validates the first one against. */
export const VISIBILITIES = ["private", "public", "guest"] as const;
/** Mirrors `CostsVisibility` in lib/types.ts and `parseCostsVisibility` in
 * lib/trips.ts — the two spellings the reader understands. */
const COSTS_VISIBILITIES = ["public", "guests"] as const;

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
   * So it stays file-only for now, and `.claude/skills/add-a-trip/SKILL.md`
   * is where a person is told to write it by hand. The place it actually
   * belongs is a call made *after* the photographs land, which is B245.
   */
};

/** A frontmatter block that validated, or the refusal to hand back. */
export type BlockResult =
  | { ok: true; lines: string[] }
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
function peopleBlock(raw: unknown): BlockResult {
  if (raw === undefined || raw === null) return NO_LINES;
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
  if (raw.length === 0) return NO_LINES;
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
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const email = typeof entry.email === "string" ? entry.email.trim().toLowerCase() : "";
    if (!name) {
      return { ok: false, error: "invalid_people", message: `${at}.name is required.` };
    }
    if (!PERSON_EMAIL_RE.test(email)) {
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
  }
  return { ok: true, lines };
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

const FIGURE_FIELDS: ReadonlySet<string> = new Set([
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
function travellersBlock(raw: unknown): BlockResult {
  if (raw === undefined || raw === null) return NO_LINES;
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_travellers",
      message:
        "travellers must be a list of figures, e.g. " +
        '[{"skin": "medium", "hair": "black", "hairStyle": "coils"}]. ' +
        "GET /api/v1/<user>/travellers/presets lists every word this takes.",
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
            `attributes first — GET /api/v1/<user>/travellers/presets returns them — so the ` +
            `file records a hair colour rather than a claim about somebody's background.`
          : `${at} has ${unknown.map((k) => JSON.stringify(k)).join(", ")}, which is not a ` +
            `figure field. Expected: ${[...FIGURE_FIELDS].join(", ")}.`,
      };
    }

    const out: string[] = [];

    const forWhom = entry.for;
    if (forWhom !== undefined && forWhom !== null) {
      const email = typeof forWhom === "string" ? forWhom.trim().toLowerCase() : "";
      if (!PERSON_EMAIL_RE.test(email)) {
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
 * `content/rates/ecb.json` points the other way. `docs/currencies.md` carries
 * the comparison and the rule of thumb — a currency worth less than the base
 * one has a small number.
 */
export function ratesBlock(raw: unknown): BlockResult {
  if (raw === undefined || raw === null) return NO_LINES;
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
  if (entries.length === 0) return NO_LINES;

  const lines = ["rates:"];
  for (const [key, value] of entries) {
    const code = normalizeCurrency(key);
    if (!code) {
      return {
        ok: false,
        error: "invalid_rates",
        message: `rates has key "${key}"; each key is a three-letter currency code, like "THB".`,
      };
    }
    const n = typeof value === "string" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        error: "invalid_rates",
        message:
          `rates.${code} must be a positive number, got ${JSON.stringify(value)}. It is how ` +
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
          `rates.${code} is ${JSON.stringify(value)}, which can only be written in exponent ` +
          `form — and the file would then read it back as text rather than as a rate. Write it ` +
          `as a plain decimal, or key the table by the larger unit.`,
      };
    }
    lines.push(`  ${code}: ${written}`);
  }
  return { ok: true, lines };
}

/**
 * The `translations:` block — the trip's title and tagline in the journal's
 * other languages.
 *
 * Refused for a locale the journal does not declare, rather than written. A
 * translation into a language nothing renders is exactly the inert write B182
 * would not ship: it lands, it reads back, and no reader ever sees it. Since
 * B220 the journal's `locales` are themselves reachable, so the refusal names
 * the call that fixes it instead of ending the conversation.
 */
function translationsBlock(raw: unknown, locales: string[]): BlockResult {
  if (raw === undefined || raw === null) return NO_LINES;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_translations",
      message:
        'translations must be an object keyed by locale, e.g. ' +
        '{"de": {"title": "Japan", "tagline": "Sechs Wochen mit dem Zug"}}.',
    };
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return NO_LINES;

  const lines = ["translations:"];
  for (const [locale, value] of entries) {
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
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false,
        error: "invalid_translations",
        message: `translations.${locale} must be an object with a title, a tagline, or both.`,
      };
    }
    const entry = value as Record<string, unknown>;
    const out: string[] = [];
    for (const field of ["title", "tagline"] as const) {
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
      const problem = singleLineProblem(`translations.${locale}.${field}`, trimmed);
      if (problem) return { ok: false, error: "invalid_translations", message: problem };
      out.push(`    ${field}: ${quoteScalar(trimmed)}`);
    }
    if (out.length === 0) {
      return {
        ok: false,
        error: "invalid_translations",
        message:
          `translations.${locale} says nothing — give it a title, a tagline, or both. The ` +
          `reader drops an empty one, so writing it would look like it took.`,
      };
    }
    lines.push(`  ${locale}:`, ...out);
  }
  return { ok: true, lines };
}

export type CreateTripResult =
  | { ok: true; id: string; ref: string }
  | { ok: false; error: string; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  /**
   * Unstated, the status comes from the dates — not from a hardcoded
   * `upcoming`.
   *
   * That default is what B72 was: a trip created with dates a week in the past
   * was written as `upcoming`, and the site then hid all three days published
   * into it behind a countdown. Reading now derives `past`/`upcoming` from
   * `start` (lib/tripTime.ts), so the word here is a snapshot rather than the
   * authority — but a trip.md whose own frontmatter contradicts its dates from
   * the minute it is written is a file nobody can read straight, and a person
   * opening it in an editor is meant to be the point.
   *
   * An explicit value is still written as asked. `current` is the one the
   * calendar cannot settle, and the other two cost nothing to record.
   */
  const status = STATUSES.includes(input.status as never)
    ? input.status!
    : calendarStatus({ start: input.start });
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
   * The three block fields, all validated before anything is on disk — B207.
   *
   * Deliberately before the `mkdirSync` below rather than woven into the
   * frontmatter array: a refusal that has already made the folder is the B204
   * failure again, and these are the fields with the most ways to be wrong.
   */
  const blocks: BlockResult[] = [
    peopleBlock(input.people),
    travellersBlock(input.travellers),
    ratesBlock(input.rates),
    translationsBlock(input.translations, user.locales),
  ];
  for (const block of blocks) {
    if (!block.ok) return { ok: false, error: block.error, message: block.message };
  }

  const front: string[] = [
    "---",
    `id: ${id}`,
    `title: ${quoteScalar(title)}`,
    ...(input.tagline?.trim() ? [`tagline: ${quoteScalar(input.tagline.trim())}`] : []),
    `start: ${quoteScalar(input.start)}`,
    `end: ${quoteScalar(input.end)}`,
    `status: ${status}`,
    ...(accent ? [`accent: ${accent}`] : []),
    `visibility: ${visibility}`,
    // Written only when it says something `visibility:` has not already said,
    // for the same reason `test:` is. Every trip carrying `listed: true` made
    // the key look like a routine part of a trip file, and it was the one key
    // the reader ignored — so the line most often present was also the line
    // least often true.
    ...(input.listed === false ? ["listed: false"] : []),
    // Written only when it narrows, on the same reasoning as `listed:` above:
    // an absent key reads as `public`, so `costsVisibility: public` in every
    // file would be a line that never says anything, in a file a person is
    // meant to be able to open and read straight. B178.
    ...(costsVisibility === "guests" ? ["costsVisibility: guests"] : []),
    // Written only when true. Every trip carrying `test: false` would make the
    // flag look like a routine part of a trip file rather than the unusual
    // thing it is.
    ...(input.test === true ? ["test: true"] : []),
    // Each is written only when it says something, on the same reasoning as
    // `listed:` and `test:` above: `people:` with nothing under it, or an
    // empty `rates:`, is a key a person opening the file has to decide to
    // ignore. `blocks` is empty-safe — an absent or empty field yields no
    // lines at all.
    ...blocks.flatMap((b) => (b.ok ? b.lines : [])),
    "---",
    "",
    input.intro?.trim() ? input.intro.trim() : "",
    "",
  ];

  fs.mkdirSync(path.join(dir, "entries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "trip.md"), front.join("\n"), "utf8");

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
