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
      defaultLocale: { type: "string", required: true },
      locales: { type: "array", required: true },
      baseCurrency: { type: "string" },
      displayCurrencies: { type: "array" },
      units: {},
      manualRates: { type: "object" },
      features: { type: "object" },
      // No API call reads a journal's default travellers — see model.mjs.
      travellers: { type: "array", fileOnly: true },
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
      people: { type: "array" },
      travellers: { type: "array" },
      rates: { type: "object" },
      tracks: { type: "object" },
      translations: { type: "object" },
      // A photograph for the index and the OG image; cannot be set at create
      // time because the media does not exist yet.
      cover: { type: "string", fileOnly: true },
      // status, accent, visibility, costsVisibility: known to the API
      // (openapi.json carries their real enum) — no rule here, faithfully.
      status: {},
      accent: {},
      visibility: {},
      costsVisibility: {},
      // test: model.mjs never gained a `type` for this one, even though the
      // day-level `test` field is enforced as a real boolean by
      // `lib/validate/entry.ts` — see test/content-model.test.ts for what
      // that silence turns out to hide, on the day side.
      test: {},
    }),

    ...rulesFor("entries/YYYY-MM-DD-slug.md", {
      title: { type: "string", required: true },
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
      location: { type: "string" },
      country: { type: "string" },
      countryCode: {
        type: "string",
        pattern: { pattern: "^[A-Z]{2}$", expected: "two capitals, like PT" },
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
      // A list of cost items, or `false` (nothing was spent), or `"unknown"`
      // (money was spent and nobody has the figures) — model.mjs states only
      // `type: "array"`, the same silence this document is carrying forward.
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
      // Request-only: instructions to the server, not content. A file never
      // carries any of these.
      weather: { apiOnly: true, because: "asks the server to look up what the weather was" },
      weatherData: { apiOnly: true, because: "a reading somebody actually took" },
      coordinates: { apiOnly: true, because: "only ever false — this day has no one place" },
      photos: { apiOnly: true, because: "only ever false — this day has no photographs" },
      idempotency_key: { apiOnly: true, because: "names one write, so a retry is safe" },
      // test: model.mjs never gained a `type` for this one — the same gap as
      // trip.md's `test` above, and see test/content-model.test.ts for what
      // it hides here specifically.
      test: {},
    }),

    ...rulesFor("costs.md", {
      budget: { type: "object" },
      costs: { type: "array" },
    }),

    ...rulesFor("plan.md", {
      route: { type: "array" },
    }),
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
      },
      "entries/YYYY-MM-DD-slug.md": {
        what: "one update. Several per day is normal",
        api: "POST /api/v1/{user}/trips/{trip}/days, then …/days/{slug}/publish",
      },
      "costs.md": {
        what: "the budget and what was spent before leaving. Optional",
        api: "PUT /api/v1/{user}/trips/{trip}/costs",
        optional: true,
      },
      "plan.md": {
        what: "the planned route, for a trip that has not happened yet. Optional",
        api: "not over the API today — write the file",
        optional: true,
      },
    },
    rules,
    named,
  };
}
