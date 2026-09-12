import "server-only";

import { EDITABLE_DAY_FIELDS } from "../api/entries";
import { TRIP_DETAIL_FIELDS } from "../api/tripFields";
import { JOURNAL_FIELD_REFUSALS, JOURNAL_PROFILE_FIELDS } from "../journals";
import type { FileDoors, FileName } from "./types";

/**
 * Which call writes each key of each file — B1577.
 *
 * ## The problem this is the answer to
 *
 * A field added to this instance had to be remembered in up to five places:
 * the route that takes it, `lib/api/openapi.ts`, `lib/contentModel/document.ts`,
 * and then — in the sibling `fernscout-helper` repository — whichever
 * hand-written key list sends it. Two tickets are the record of that going
 * wrong: **B1518** (`teaser`, then `cover`, each accepted locally and silently
 * never sent) and **B1569** (`ownerTel` and `travellers`, the same shape one
 * level up). Six such lists were found in the helper; only one was protected,
 * and the least protected was the day's — where almost every new field lands.
 *
 * `never-in-file` and `never-over-api` are the closest existing vocabulary and
 * answer a different question: which *side* a key lives on, not which call
 * writes it. Nothing said the second thing, so every client had to know it by
 * heart.
 *
 * ## What makes this different from a sixth list
 *
 * **It is derived, and the derivation is the point.** `EDITABLE_DAY_FIELDS`,
 * `TRIP_DETAIL_FIELDS`, `JOURNAL_PROFILE_FIELDS` and `JOURNAL_FIELD_REFUSALS`
 * are the constants the routes and the validators actually use; this module
 * imports them and says which call each belongs to. Adding a field to one of
 * those constants changes this document with no second edit.
 *
 * **And what cannot be derived is gated.** A key that reaches a file but no
 * constant — because its door is a route of its own, or because it has none —
 * has to be named below, and `test/content-model-doors.test.ts` fails when a
 * key of any file appears in neither `update` nor `noUpdate`. That is the
 * whole ticket: the enforcement lives where the field is added, rather than
 * as a warning in a client that can only notice afterwards.
 *
 * ## Why `noUpdate` carries a sentence
 *
 * A key with no door is not the same as a key nobody has got round to, and
 * only the reason tells them apart. A client that cannot send `baseCurrency`
 * needs to say *why* to the person who just edited it — which is B1504, and
 * `JOURNAL_FIELD_REFUSALS` already holds those three sentences because the
 * API says them to a caller who tried.
 */

/** Every field of one constant, through the same call. */
function through(call: string, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, call]));
}

const DAY = "PATCH /api/v1/{user}/trips/{trip}/days/{slug}";
const TRIP = "PATCH /api/v1/{user}/trips/{trip}";
const CONFIG = "PATCH /api/v1/{user}/config";
const COSTS = "PUT /api/v1/{user}/trips/{trip}/costs — the whole file";
const PLAN = "PUT /api/v1/{user}/trips/{trip}/plan — the whole file";

export function contentModelDoors(): Record<FileName, FileDoors> {
  return {
    "config.json": {
      create: "POST /api/v1/journals",
      call: CONFIG,
      update: {
        ...through(CONFIG, JOURNAL_PROFILE_FIELDS),
        // Its own call, because the server refuses a body naming `features`
        // alongside a profile field — deliberately, so "turn mail off" cannot
        // also rename the journal by accident.
        features: `${CONFIG} with {"features": {…}} — a call of its own`,
      },
      noUpdate: {
        ...JOURNAL_FIELD_REFUSALS,
        ownerName: "Set when the journal is created, and read back on GET .../config.",
        ownerNickname: "Set when the journal is created, and read back on GET .../config.",
        username: "The journal's own address. Renaming one would break every URL it has.",
      },
    },
    "trip.md": {
      create: "POST /api/v1/{user}/trips",
      call: TRIP,
      update: {
        ...through(TRIP, TRIP_DETAIL_FIELDS),
        // Four doors of their own, each with rules the general PATCH must not
        // duplicate. `visibility`, `listed` and `teaser` share one, because
        // they only make sense decided together (B587).
        ...through(`${TRIP}/visibility`, ["visibility", "listed", "teaser"]),
        ...through(`${TRIP}/people`, ["people"]),
        ...through(`${TRIP}/travellers`, ["travellers"]),
        ...through(`${TRIP}/rates`, ["rates"]),
        ...through(`${TRIP}/tracks`, ["tracks"]),
      },
      noUpdate: {
        id: "Addresses the trip rather than describing it — it is the folder's name.",
        status:
          "The server's own computation from start and end, not a value to set (B1521).",
        test:
          "Set once at creation. Content nobody lived cannot become content somebody did, " +
          "or the banner a reader relies on would be a thing that comes and goes.",
      },
    },
    "entries/YYYY-MM-DD-slug.md": {
      create: "POST /api/v1/{user}/trips/{trip}/days",
      call: DAY,
      update: {
        ...through(DAY, EDITABLE_DAY_FIELDS),
        // Not fields on a PATCH at all, and each named so a client does not
        // read their absence as "no door".
        gallery:
          "POST /api/v1/{user}/trips/{trip}/media — photographs are files, not a field. " +
          "Captions and per-photo visibility are editable on the day itself.",
        status:
          "POST /api/v1/{user}/trips/{trip}/days/{slug}/publish, or …/unpublish. Never a " +
          "field on a write, so a day cannot be published by editing it (B28).",
        without:
          `Sent on ${DAY} as the field itself set to false — "costs": false means there was ` +
          "none (B560).",
        unrecorded:
          `Sent on ${DAY} as the field itself set to "unknown" — there was some and it is ` +
          "gone (B560).",
      },
      noUpdate: {
        slug: "Addresses the day. The instance assigns it from the title on create.",
        cover:
          "A trip's cover, not a day's — set on the trip once the photograph exists " +
          "(PATCH .../trips/{trip}).",
      },
    },
    "costs.md": {
      create: "PUT /api/v1/{user}/trips/{trip}/costs",
      call: COSTS,
      update: through(COSTS, ["budget", "costs"]),
      noUpdate: {},
    },
    "plan.md": {
      create: "PUT /api/v1/{user}/trips/{trip}/plan",
      call: PLAN,
      update: through(PLAN, ["route"]),
      noUpdate: {},
    },
  };
}
