// `content-model.json` — the file shape a Fernscout journal must have,
// published so `fernscout-helper` (and anything else written against this
// instance) stops copying it by hand. See
// `docs/plans/W41-the-file-shape-is-published.md` for the whole story and
// `lib/contentModel/types.ts` for the vocabulary this is written in.
//
// ## Where this came from
//
// Derived, key for key, from `fernscout-helper`'s `.claude/skills/shared/model.mjs`
// — a **faithful copy**, not a fresh opinion. Every field below states no more
// than `model.mjs` already did: a `type` where it had one, `required` where it
// said so, `pattern` where it named one, and `never-in-file`/`never-over-api`
// for the fields it called `apiOnly`/`fileOnly`. Where `model.mjs` was silent —
// most enums, and every field the API itself governs — this is silent too,
// on purpose: that silence is `model.mjs`'s own rule ("A `type` or `enum`
// below is therefore a deliberate statement that the API does not carry this
// key"), and repeating it here is the whole point of a *faithful* first
// version. `test/content-model.test.ts` is where the gaps this leaves are
// found and reported, not quietly closed.
//
// **This step changes no behaviour, on either side.** Anything this document
// gets wrong was already wrong in `model.mjs`, and is now at least visible to
// a test that runs both `lib/validate/*` and this document over the same
// fixtures — see that file for what it actually found.
import type { ContentModelDocument, FileName, PrimitiveType, Rule } from "./types";
import { contentModelDoors } from "./doors";
import { FEATURE_NAMES } from "../config";

/** A regex source is capped well short of anything that could be expensive
 * to match — every pattern below is a handful of characters, and a future one
 * that isn't belongs in `lib/validate/*`, not here. W41's "client runs a
 * stranger's document". */
export const MAX_PATTERN_LENGTH = 100;

const ISO_DATE = { pattern: "^\\d{4}-\\d{2}-\\d{2}$", expected: "a date like 2026-06-24" };

/**
 * One key's shape, in the same reduced terms `model.mjs` states it in.
 * `rulesFor` below turns this into the `Rule[]` a key needs.
 */
type KeySpec = {
  type?: PrimitiveType;
  required?: boolean;
  pattern?: { pattern: string; expected: string };
  enum?: readonly (string | number | boolean)[];
  /** Crosses the API; a file must never carry it. */
  apiOnly?: boolean;
  /** Lives only in the file; never sent over the API. */
  fileOnly?: boolean;
  because?: string;
};

/**
 * A key that is `apiOnly` never appears in a file at all, so a `type` or
 * `pattern` stated for it would describe a value that can never be there to
 * check — `model.mjs` carries `type` on a couple of these anyway (documenting
 * what the API takes), but a rule that can never fire is not a rule this
 * vocabulary has room for. Only the `never-in-file` assert is emitted for
 * one; everything else about it is prose, in `keys` below, not a `Rule`.
 */
function rulesFor(where: FileName, keys: Record<string, KeySpec>): Rule[] {
  const rules: Rule[] = [];
  const knownInFile: string[] = [];

  for (const [path, spec] of Object.entries(keys)) {
    if (spec.apiOnly) {
      rules.push({ where, path, assert: "never-in-file", because: spec.because });
      continue;
    }
    knownInFile.push(path);
    if (spec.required) rules.push({ where, path, assert: "required" });
    if (spec.type) rules.push({ where, path, assert: "type", type: spec.type, because: spec.because });
    if (spec.pattern) {
      rules.push({
        where,
        path,
        assert: "pattern",
        pattern: spec.pattern.pattern,
        expected: spec.pattern.expected,
      });
    }
    if (spec.enum) rules.push({ where, path, assert: "enum", values: spec.enum });
    if (spec.fileOnly) rules.push({ where, path, assert: "never-over-api", because: spec.because });
  }

  rules.push({ where, path: "", assert: "known-key", keys: knownInFile });
  return rules;
}

export function contentModel(): ContentModelDocument {
  const rules: Rule[] = [
    ...rulesFor("config.json", {
      // apiOnly: crosses `POST /api/v1/journals` or `PATCH …/config`, never
      // the file — the file writes `owner.name`/`owner.nickname`/`owner.tel`
      // instead, and the username is the folder name.
      ownerName: { apiOnly: true, because: "the file carries this as owner.name" },
      ownerNickname: { apiOnly: true, because: "the file carries this as owner.nickname" },
      ownerTel: { apiOnly: true, because: "the file carries this as owner.tel" },
      username: { apiOnly: true, because: "the folder name is the username" },

      title: { type: "string", required: true },
      // {name, nickname, email} — file-only because the API takes ownerName
      // and ownerNickname instead, and the address from the signup.
      owner: { type: "object", required: true, fileOnly: true },
      tagline: { type: "string" },
      // visibility, units: known to the API (openapi.json carries their real
      // enum) — no `type`/`enum` here, faithfully, same as model.mjs. Still
      // counted as keys this file may carry, so the crosscheck below does
      // not mistake them for something this document has never heard of.
      visibility: {},
      startLocation: { type: "string" },
      // B615: neither is `required`. `parseUser` in lib/config.ts defaults
      // both when absent — `locales` to `["en"]`, then `defaultLocale` to
      // `locales[0]` — so a config naming neither is a valid journal in
      // English, not two errors.
      defaultLocale: { type: "string" },
      locales: { type: "array" },
      baseCurrency: { type: "string" },
      displayCurrencies: { type: "array" },
      units: {},
      manualRates: { type: "object" },
      features: { type: "object" },
      // B1526: no longer fileOnly. `PATCH …/config` accepts it and
      // `GET …/travellers` reads it back, so this key now has an
      // openapi.json field description to borrow a tip from at run time,
      // the same way every other non-fileOnly key here does — the stale
      // "there is no API call for this" prose that used to live in this
      // comment (B620) would otherwise mislead a hosted journal, which has
      // no file to fall back on.
      travellers: { type: "array" },
      // This journal's own upload allowance; may narrow the server's.
      media: { type: "object", fileOnly: true },
    }),

    ...rulesFor("trip.md", {
      id: {
        type: "string",
        required: true,
        pattern: { pattern: "^[a-z0-9][a-z0-9-]*$", expected: "lowercase letters, digits and hyphens" },
        because: "must equal the folder name",
      },
      title: { type: "string", required: true },
      start: { type: "string", required: true, pattern: ISO_DATE, because: "a trip without start and end is skipped at every reading path" },
      end: { type: "string", required: true, pattern: ISO_DATE },
      tagline: { type: "string" },
      // The prose under the frontmatter; the API calls it `intro`.
      intro: { apiOnly: true, because: "the prose under the frontmatter; the API calls it intro" },
      listed: { type: "boolean", because: "false keeps a public trip out of the sitemap, the feed and the switcher — it only ever narrows" },
      // B1389: absent from this document entirely until now, though the API
      // accepts, validates, documents and parses it. A closed trip named on
      // the trips page without being opened — a locked card with its title
      // and dates and nothing else — refused on a public trip, where
      // `listed` is the key that decides instead.
      teaser: {
        type: "boolean",
        because: "a closed trip saying it exists; refused on a public trip, where `listed` is the gate",
      },
      people: { type: "array" },
      travellers: { type: "array" },
      rates: { type: "object" },
      tracks: { type: "object" },
      translations: { type: "object" },
      // A photograph for the index and the OG image; cannot be set at create
      // time because the media does not exist yet. fileOnly with no
      // openapi.json description to borrow a tip from, so the prose is
      // carried here — B620.
      cover: {
        type: "string",
        fileOnly: true,
        because:
          "a photograph from the trip for the index and the OG image. It cannot be set at " +
          "create time — the media does not exist yet",
      },
      // status, accent, visibility, costsVisibility: known to the API
      // (openapi.json carries their real enum) — no rule here, faithfully.
      status: {},
      accent: {},
      visibility: {},
      costsVisibility: {},
      // B616: model.mjs never gained a `type` for this one, even though
      // `createTrip` in lib/tripWrite.ts refuses a non-boolean `test` the same
      // way `checkTest` does for a day (see the entries block below). Fixed
      // here. B620: `test` is also one of the two keys `model.mjs` marks
      // `noTip: true` — see `files["trip.md"].noTip` below.
      //
      // B617 asked, of every key here, whether the file/wire difference is
      // real: `test` is not one — a trip's frontmatter carries `test: true`
      // literally (`lib/tripWrite.ts`'s own writer emits that line), and the
      // API takes the same key under the same name. Neither `apiOnly` nor
      // `fileOnly` applies; this is deliberately a plain, shared key.
      test: { type: "boolean" },
    }),

    ...rulesFor("entries/YYYY-MM-DD-slug.md", {
      title: { type: "string", required: true },
      // The pattern only checks the YYYY-MM-DD shape, same as trip.md's
      // start/end — `checkDate`/`isRealCalendarDate` in lib/validate/entry.ts
      // also requires a real calendar date (no 2026-13-40), which is Date
      // arithmetic no `pattern` here should re-derive (leap years). That gap
      // is declared as the `entry-date-is-a-real-calendar-date` named check
      // below rather than left silent — B616.
      date: {
        type: "string",
        required: true,
        pattern: ISO_DATE,
        because: "must match the filename, and fall inside the trip",
      },
      content: { type: "string", required: true },
      time: {
        type: "string",
        pattern: { pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", expected: "24-hour, like 18:40" },
      },
      // B42. The IANA name `time` is a wall clock in. No pattern: the list
      // of real zone names is the tz database's and changes with it, so the
      // server asks `Intl` whether it knows the name (isUsableZone in
      // lib/digest/quiet.ts) rather than keeping a copy that goes stale.
      timezone: {
        type: "string",
        because: "what 09:15 means — an IANA name like Asia/Bangkok, never an offset",
      },
      location: { type: "string" },
      country: { type: "string" },
      // B615: model.mjs's pattern was capitals-only. The server's own check
      // (COUNTRY_CODE_RE in lib/validate/entry.ts) is explicitly
      // case-insensitive — it uppercases on the way in — so this document
      // must not refuse what the instance accepts. Capitals stay the house
      // style, in prose, not as the enforced shape.
      countryCode: {
        type: "string",
        pattern: { pattern: "^[A-Za-z]{2}$", expected: "two letters, ISO 3166-1 alpha-2 — capitals are the house style, like PT" },
        because: "draws the flag",
      },
      lat: { type: "number" },
      lng: { type: "number" },
      // transportMode, travelScene: known to the API (openapi.json carries
      // their real enum) — no rule here, faithfully, same as model.mjs.
      transportMode: {},
      travelScene: {},
      transportFrom: { type: "string" },
      transportTo: { type: "string" },
      tags: { type: "array" },
      // `type: "array"` is correct here and only here: a *file* never carries
      // `costs: false` or `costs: "unknown"` — see `without`/`unrecorded`
      // below, which is where those two answers actually live on disk. The
      // wire accepts `costs: false`/`"unknown"` too (`checkCosts` in
      // lib/validate/entry.ts), but that is the file/wire boundary a
      // publishing client crosses on the way out, not a gap in this rule —
      // B617, and the mapping test/content-model.test.ts applies before
      // comparing the two.
      costs: { type: "array" },
      translations: { type: "object" },
      // What this day deliberately has none of, and what it had and nobody
      // wrote down — written by sending e.g. `costs: false` / `costs:
      // "unknown"`, never held in the file under their own names.
      without: { type: "array", fileOnly: true },
      unrecorded: { type: "array", fileOnly: true },
      // The photographs; not part of the day's body over the API.
      gallery: { type: "array", fileOnly: true },
      cover: { type: "string", fileOnly: true },
      status: {
        type: "string",
        enum: ["draft"],
        fileOnly: true,
        because: "publishing is a separate call, never a field",
      },
      // The slug the instance assigned when publish.mjs first wrote this day.
      slug: { type: "string", fileOnly: true },
      // `coordinates`/`photos` are the two request-only keys here, genuinely
      // never in a file: each is only ever sent `false`, and nothing on disk
      // ever carries either name. `weather`/`weatherData` are a different
      // shape, and used to be wrongly lumped in with these — B1403.
      // `weather: true` is written onto a day's own frontmatter by
      // lib/api/entries.ts's own writer, and a lookup's answer (or a reading
      // a person handed over) is written there too, under `weatherData`
      // itself: both are plain, shared keys, the same as `test` above, not
      // apiOnly. A `never-in-file` rule on either was simply false, and is
      // the likely reason a fresh validator read a filled `weatherData` block
      // as invented — the published vocabulary said no file could carry one
      // at all. `because` here is provenance, not permission: the API is the
      // only door that may put a value in this key; this rule only says the
      // key itself is real once it is through it.
      weather: { type: "boolean", because: "the server's own lookup, once asked for — never an agent's belief" },
      weatherData: {
        type: "object",
        because:
          "a reading, from the server's lookup or handed over with its source — never invented, " +
          "and never removed on the strength of a validator's own say-so that it looks invented",
      },
      coordinates: { apiOnly: true, because: "only ever false — this day has no one place" },
      photos: { apiOnly: true, because: "only ever false — this day has no photographs" },
      idempotency_key: { apiOnly: true, because: "names one write, so a retry is safe" },
      // B1584, found by B1577's gate: both are in `EDITABLE_DAY_FIELDS` and
      // appeared in no published contract as keys of a day, so a client had no
      // way to learn they exist. Flat only on the wire — the file keeps the
      // same two facts inside each `gallery:` entry.
      captions: { apiOnly: true, because: "the file carries this as gallery[].caption" },
      photoVisibility: { apiOnly: true, because: "the file carries this as gallery[].visibility" },
      dryRun: { apiOnly: true, because: "checks the body and writes nothing — never a file's own field" },
      // B616: model.mjs never gained a `type` for this one, even though
      // `checkTest` in lib/validate/entry.ts refuses anything but a real
      // boolean. Fixed here. B620: also one of the two keys model.mjs marks
      // `noTip: true` — see `files["entries/YYYY-MM-DD-slug.md"].noTip`
      // below.
      //
      // B617: same question as trip.md's `test` above, and the same answer —
      // `lib/entries.ts` reads `test` straight off a day's own frontmatter
      // (`data.test === true`), so this is a plain, deliberately shared key,
      // not a file/wire split.
      test: { type: "boolean" },
      // B632: known to the API (openapi.json carries the real enum, the same
      // two words a photograph's own label takes) — a plain, deliberately
      // shared key, same as `test` above: `lib/entries.ts` reads it straight
      // off the day's own frontmatter.
      visibility: {},
    }),

    ...rulesFor("costs.md", {
      budget: { type: "object" },
      costs: { type: "array" },
    }),

    ...rulesFor("plan.md", {
      route: { type: "array" },
    }),

    // B616: `parseFeatures` in lib/config.ts refuses a `features` member that
    // is not `{ enabled: boolean }` (`shape`, over the one wildcard this
    // vocabulary has) and refuses a key naming no known capability
    // (`known-key`). model.mjs stopped at `type: "object"` on the whole map —
    // B598 added exactly these checks to the *validator*, not to model.mjs,
    // so the document inherited the gap. Both fit the existing eight kinds,
    // so this is fixed here rather than filed as a named check; `FEATURE_NAMES`
    // is imported from lib/config.ts so the two lists cannot drift apart the
    // way a hand-copied one would.
    {
      where: "config.json",
      path: "features.*",
      assert: "shape",
      members: { enabled: "boolean" },
      because: "each capability is on or off; anything else is refused",
    },
    {
      where: "config.json",
      path: "features",
      assert: "known-key",
      keys: [...FEATURE_NAMES],
    },
  ];

  const named = [
    {
      kind: "named" as const,
      id: "day-answers-tracked-fields",
      because: "needs the trip's tracks: and the day's without:/unrecorded: together",
      where: ["trip.md", "entries/YYYY-MM-DD-slug.md"] as const,
    },
    {
      kind: "named" as const,
      id: "day-translations-match-locales",
      because:
        "a day writing only its own language is fine when the journal declares one locale, and " +
        "refused when it declares more — needs the journal's locales and written language " +
        "together with the day's own translations:",
      where: ["config.json", "entries/YYYY-MM-DD-slug.md"] as const,
    },
    {
      kind: "named" as const,
      id: "plan-only-for-upcoming-trips",
      because: "plan.md is read only once the trip's own status is upcoming — a cross-file read of trip.md",
      where: ["trip.md", "plan.md"] as const,
    },
    {
      kind: "named" as const,
      id: "cost-line-known-keys",
      because:
        "each item of a costs: array needs its own known-key check against label/amount/currency/" +
        "category; the one wildcard this vocabulary has (features.*) reaches a map's members, not " +
        "an array element, so this cannot be a `known-key` rule at a path",
      where: ["entries/YYYY-MM-DD-slug.md", "costs.md"] as const,
    },
    {
      kind: "named" as const,
      id: "gallery-item-known-keys",
      because:
        "each item of a gallery: array needs its own known-key check against src/type/width/height/" +
        "caption/poster/from, for the same reason cost-line-known-keys is named rather than expressed",
      where: ["entries/YYYY-MM-DD-slug.md"] as const,
    },
    {
      kind: "named" as const,
      id: "entry-date-is-a-real-calendar-date",
      because:
        "the pattern above only checks the YYYY-MM-DD shape; a real calendar check " +
        "(no 2026-13-40) needs the same Date-arithmetic lib/validate/entry.ts's " +
        "isRealCalendarDate does, which this vocabulary's pattern kind cannot express and " +
        "should not re-derive (leap years) — B616. Not needed for trip.md's start/end: " +
        "lib/tripWrite.ts's DATE_RE is exactly as shallow as this document's pattern, on purpose.",
      where: ["entries/YYYY-MM-DD-slug.md"] as const,
    },
    {
      kind: "named" as const,
      id: "budget-total-and-days-are-positive",
      because:
        "validateCostsPut in lib/validate/costs.ts refuses a non-positive budget.total or " +
        "budget.days; no assert kind in this vocabulary expresses a numeric range, only " +
        "type/enum/pattern/shape — B616",
      where: ["costs.md"] as const,
    },
  ];

  return {
    contentModel: 1,
    files: {
      "config.json": {
        what: "who this journal belongs to, and what it switches on",
        api: "POST /api/v1/journals to create, PATCH /api/v1/{user}/config to change",
      },
      "trip.md": {
        what: "the trip itself. Frontmatter, then the intro prose as the body",
        api: "POST /api/v1/{user}/trips",
        // B620: content nobody lived, written to prove the pipeline works —
        // never a choice to offer about a real holiday. See
        // `ContentModelDocument.noTip` in types.ts.
        noTip: ["test"],
      },
      "entries/YYYY-MM-DD-slug.md": {
        what: "one update. Several per day is normal",
        api: "POST /api/v1/{user}/trips/{trip}/days, then …/days/{slug}/publish",
        noTip: ["test"],
      },
      "costs.md": {
        what: "the budget and what was spent before leaving. Optional",
        api: "PUT /api/v1/{user}/trips/{trip}/costs",
        optional: true,
      },
      "plan.md": {
        what: "the planned route, for a trip that has not happened yet. Optional",
        api: "GET/PUT /api/v1/{user}/trips/{trip}/plan",
        optional: true,
      },
    },
    rules,
    named,
    doors: contentModelDoors(),
  };
}
