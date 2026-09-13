import "server-only";
import { z } from "zod";
import { serverSite } from "../../site";
import { getDefaultUsername, listedUsernames } from "../../users";
import { ERROR_CODES } from "../errorCodes";
import { V2_ONLY_CODES } from "./route";
import {
  dayDoc,
  dayWrite,
  dayPatch,
  tripCreate,
  tripPatch,
  tripDoc,
  publishRequest,
  sendRequest,
  journalDoc,
  journalWrite,
  journalPatch,
  mediaIntent,
  mediaItem,
  MEDIA_KINDS,
  instanceStatus,
  journalStatus,
  figureDoc,
  purchaseCreate,
  purchaseDoc,
  ledgerRow,
  errorEnvelope,
  geocodeRequest,
  geocodeResponse,
  journalCreate,
  postcardOrderWrite,
  postcardOrderDoc,
  statementRead,
  costsApplyRequest,
  inboxList,
  inviteWrite,
  inviteDoc,
  contactCreate,
  contactPatch,
  contactDoc,
  channelsPatch,
  channelsDoc,
} from "./schemas";
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
} from "../../travellers/vocabulary";
import { BOOK_SIZES, COVER_TYPES } from "../../photobook/spec";
import { EXTRA_STORAGE_BYTES, EXTRA_STORAGE_CREDITS, POSTCARD_CREDITS } from "../../credits/pricing";

/**
 * The generated v2 machine contract — B1596/B1608 onward, this ticket
 * (`generate /api/v2/openapi.json FROM the schemas`).
 *
 * `lib/api/openapi.ts` (v1) is HAND-WRITTEN: a second document beside every
 * route, kept in sync by a test that fails when the two drift. That is
 * exactly the failure mode this file exists to retire for v2 — the frozen
 * Zod contract in `lib/api/v2/schemas/` already IS the spec (see that
 * folder's own header comment), so the document is built by asking those
 * schemas what they accept, via Zod v4's own `z.toJSONSchema()`
 * (`node_modules/zod` ships this natively — no new dependency).
 *
 * What is still written by hand here is the OPERATION LIST: which path and
 * verb parses which request schema and answers with which response schema
 * and which refusals. That list cannot itself be generated (nothing declares
 * "this route's body is schema X" in a form a generator could read without
 * executing the route), so `test/openapi-v2-contract.test.ts` holds the other
 * half: it walks `app/api/v2/` on disk and fails if this list is missing an
 * operation the filesystem actually has, or claims one that does not exist.
 * Between the two, neither the fields (generated from the frozen schemas)
 * nor the route inventory (checked against the filesystem) can drift
 * unnoticed.
 */

/** A single Zod schema turned into a plain JSON Schema object, suitable for
 * an OpenAPI 3.1 `schema` node (3.1's `schema` IS JSON Schema 2020-12). */
function schemaOf(zodSchema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(zodSchema) as Record<string, unknown>;
}

const jsonBody = (schema: z.ZodType, description?: string) => ({
  description: description ?? "",
  required: true,
  content: { "application/json": { schema: schemaOf(schema) } },
});

const jsonResponse = (status: number, schema: z.ZodType, description: string) => ({
  [status]: { description, content: { "application/json": { schema: schemaOf(schema) } } },
});

const svgResponse = (status: number, description: string) => ({
  [status]: {
    description,
    content: { "image/svg+xml": { schema: { type: "string" } } },
  },
});

const noBodyResponse = (status: number, description: string) => ({
  [status]: { description },
});

type Refusal = { status: number; code: string; description?: string };

/** Every refusal shares the one error envelope. `code` documents which value
 * `error` carries for THIS refusal — `errorEnvelope`'s own `error` enum is
 * every code the API can ever answer with, so a per-refusal example is what
 * actually says which one a caller gets here. */
function refusalResponses(refusals: Refusal[]): Record<string, unknown> {
  const byStatus = new Map<number, Refusal[]>();
  for (const r of refusals) {
    const list = byStatus.get(r.status) ?? [];
    list.push(r);
    byStatus.set(r.status, list);
  }
  const out: Record<string, unknown> = {};
  for (const [status, list] of byStatus) {
    out[status] = {
      description: list.map((r) => `\`${r.code}\`${r.description ? ` — ${r.description}` : ""}`).join("; "),
      content: {
        "application/json": {
          schema: schemaOf(errorEnvelope),
          examples: Object.fromEntries(
            list.map((r) => [r.code, { value: { error: r.code, message: ERROR_CODES_ANY[r.code] ?? r.code } }]),
          ),
        },
      },
    };
  }
  return out;
}

// `ERROR_CODES` is `as const satisfies Record<string, string>` (B1596) —
// widened here purely to index it with a runtime-only code string built from
// this file's own refusal table, never to add a code the vocabulary lacks.
const ERROR_CODES_ANY: Record<string, string> = ERROR_CODES;
// Every code the v2 vocabulary can answer with — `ERROR_CODES` plus the
// (today empty) v2-only extension, exactly what `errorEnvelope`'s own
// `error` enum is built from (schemas/shared.ts). Referenced so a refusal
// entry below that names a code neither list has fails visibly rather than
// silently documenting a typo.
const V2_ERROR_VOCABULARY = new Set<string>([...Object.keys(ERROR_CODES), ...V2_ONLY_CODES]);

function ref(code: string, status: number, description?: string): Refusal {
  if (!V2_ERROR_VOCABULARY.has(code)) {
    throw new Error(`openapi-v2: refusal code "${code}" is not in ERROR_CODES or V2_ONLY_CODES`);
  }
  return { status, code, description };
}

// ── refusals every bearer-authenticated call can answer with ──────────────
const missingToken = () => ref("missing_token", 401);
const invalidToken = () => ref("invalid_token", 401);
const outOfScope = () => ref("out_of_scope", 403, "the token is for a different journal or trip");
const forbidden = () => ref("forbidden", 403, "this call is the journal owner's; a trip-scoped token cannot do it");
const noSuchJournal = () => ref("no_such_journal", 404);
const authRefusals = [missingToken(), invalidToken()];
const ownerRefusals = [...authRefusals, outOfScope(), forbidden(), noSuchJournal()];
const tripWriteRefusals = [...authRefusals, outOfScope(), ref("unknown_trip", 404), forbidden()];

// ── ad-hoc response/request shapes with no schema of their own in
// lib/api/v2/schemas/ (frozen — nothing there was edited to build these).
// Every enum still comes from the constant its own route imports, never
// retyped. ──────────────────────────────────────────────────────────────

const usernameAvailability = z.strictObject({
  username: z.string(),
  available: z.boolean(),
  reason: z.enum(["invalid_username", "username_taken", "reserved_username"]).optional(),
});

const journalCreated = z.strictObject({
  ok: z.literal(true),
  user: z.string(),
  url: z.string(),
  signIn: z.string().optional(),
  signInNote: z.string().optional(),
  documentation: z.string(),
  localesNote: z.string().optional(),
  visibility: z.string(),
  token: z.string(),
  expires: z.string(),
  scope: z.array(z.string()),
  welcomeMailed: z.boolean(),
  note: z.string().optional(),
  next: z.string(),
});

const storageDoc = z.strictObject({
  usedBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive().nullable(),
  purchasedBytes: z.number().int().nonnegative(),
  remainingBytes: z.number().int().nonnegative().nullable(),
  breakdown: z.array(z.strictObject({ key: z.string(), label: z.string(), bytes: z.number() })),
  reclaimable: z.strictObject({
    photobooks: z.number(),
    postcards: z.number(),
    stagedFiles: z.number(),
    bytes: z.number(),
    files: z.number(),
  }),
  extension: z.strictObject({
    credits: z.literal(EXTRA_STORAGE_CREDITS),
    addsBytes: z.literal(EXTRA_STORAGE_BYTES),
  }),
});

const figurePresets = z.strictObject({
  user: z.string(),
  maxFigures: z.literal(MAX_FIGURES),
  vocabulary: z.strictObject({
    skin: z.array(z.enum(Object.keys(SKIN) as [string, ...string[]])),
    hair: z.array(z.enum(Object.keys(HAIR) as [string, ...string[]])),
    eyes: z.array(z.enum(Object.keys(EYES) as [string, ...string[]])),
    hairStyle: z.array(z.enum(HAIR_STYLES)),
    outfit: z.array(z.enum(OUTFITS)),
    build: z.array(z.enum(BUILDS)),
    age: z.array(z.enum(AGES)),
    accessories: z.array(z.enum(ACCESSORIES)),
    cloth: z.array(z.enum(Object.keys(CLOTH) as [string, ...string[]])),
  }),
  fields: z.record(z.string(), z.string()),
  example: z.record(z.string(), z.unknown()),
  hex: z.string(),
  preview: z.string(),
  startingPoints: z.array(z.strictObject({ name: z.string(), resolve: z.unknown() })),
  note: z.string(),
});

const postcardRecipient = z.strictObject({
  contactId: z.string(),
  name: z.string(),
  city: z.string(),
  country: z.string().nullable(),
  locale: z.string().nullable(),
});

const postcardRecipients = z.strictObject({
  creditsEach: z.literal(POSTCARD_CREDITS),
  recipients: z.array(postcardRecipient),
  note: z.string().optional(),
});

const postcardTexts = z.strictObject({
  trip: z.string(),
  writtenLocale: z.string(),
  locales: z.array(z.string()),
  days: z.array(
    z.strictObject({
      slug: z.string(),
      date: z.string(),
      title: z.string(),
      texts: z.record(z.string(), z.string()),
    }),
  ),
});

/** `lib/photobook/orders.ts` keeps `status` as a plain `string` column with
 * no exported closed-enum constant (only `PHOTOBOOK_OUTCOME_STATES`, which
 * names FAILURE reasons, not the order's own lifecycle) — so this stays a
 * free string rather than inventing a list this file would own alone. */
const photobookOrderDoc = z.strictObject({
  id: z.string(),
  status: z.string(),
  trip: z.string(),
  size: z.enum(Object.keys(BOOK_SIZES) as [string, ...string[]]),
  coverType: z.enum(COVER_TYPES),
  pages: z.number().int().nonnegative(),
  volumes: z.number().int().positive(),
  credits: z.number().int().nonnegative(),
  files: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  print: z
    .strictObject({
      contactId: z.string(),
      quotedCredits: z.number(),
      quotedAt: z.string(),
      shipmentMethodUid: z.string(),
      providerRef: z.string().optional(),
      failure: z.string().optional(),
    })
    .optional(),
});

const okTrue = z.strictObject({ ok: z.literal(true) });

const deletionRequestedDoc = (kind: "journal" | "trip") =>
  z.strictObject({
    ok: z.literal(true),
    deleted: z.literal(false),
    status: z.literal("confirmation_sent"),
    mailedTo: z.string(),
    expires: z.string(),
    willDelete:
      kind === "journal"
        ? z.strictObject({ journal: z.string(), trips: z.number(), days: z.number(), files: z.number(), size: z.string() })
        : z.strictObject({
            trip: z.string(),
            id: z.string(),
            days: z.number(),
            files: z.number(),
            size: z.string(),
            mediaGoesToo: z.literal(true),
          }),
    note: z.string(),
    next: z.string(),
  });

const dayDeleted = z.strictObject({
  ok: z.literal(true),
  slug: z.string(),
  deleted: z.literal(true),
  published: z.literal(false),
  mediaKept: z.literal(true),
  note: z.string(),
});

const dayPublished = z.strictObject({
  slug: z.string(),
  status: z.literal("published"),
  url: z.string(),
  note: z.string(),
  mail: z.record(z.string(), z.unknown()).optional(),
  whatsapp: z.record(z.string(), z.unknown()).optional(),
  notify: z
    .strictObject({
      channels: z.array(z.strictObject({ channel: z.enum(["mail", "whatsapp"]), url: z.string() })),
      ask: z.string(),
    })
    .optional(),
});

const dayPublishPreview = z.strictObject({ ok: z.literal(true), written: z.literal(false), dryRun: z.literal(true), note: z.string() });

const dayUnpublished = z.strictObject({ ok: z.literal(true), slug: z.string(), status: z.literal("draft"), note: z.string() });

const daySendResult = z.strictObject({
  ok: z.literal(true),
  slug: z.string(),
  mail: z.record(z.string(), z.unknown()).optional(),
  whatsapp: z.record(z.string(), z.unknown()).optional(),
});

const costsApplyResult = z.strictObject({
  trip: z.string(),
  total: z.number().int().nonnegative(),
  written: z.array(z.strictObject({ date: z.string(), slug: z.string(), kept: z.number().int().nonnegative() })),
  orphaned: z.array(z.string()),
  message: z.string(),
  next: z.string().optional(),
});

const mediaDeleted = z.strictObject({ ok: z.literal(true), src: z.string() });

const inboxDeleted = z.strictObject({ ok: z.literal(true), id: z.string(), filename: z.string() });

const figureDeleted = z.strictObject({ deleted: z.string(), dryRun: z.boolean().optional() });

const contactActionResult = z.strictObject({
  ok: z.literal(true),
  contact: contactDoc,
  tripsOpened: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
});

const contactSendResult = z.strictObject({ ok: z.literal(true), sent: z.boolean(), dryRun: z.boolean().optional() });

const contactSelfResult = z.strictObject({ ok: z.literal(true), contact: contactDoc.optional(), dryRun: z.boolean().optional() });

const contactDeleted = z.strictObject({ id: z.string(), deleted: z.literal(true), dryRun: z.boolean().optional() });

const contactImportResult = z.strictObject({
  filed: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  results: z.array(z.record(z.string(), z.unknown())),
  next: z.string(),
});

const inviteRevoked = z.strictObject({ id: z.string(), revoked: z.literal(true), note: z.string().optional(), dryRun: z.boolean().optional() });

const inviteCreated = z.object({
  ...inviteDoc.shape,
  url: z.string(),
  note: z.string().optional(),
});

// ── pagination-wrapped list responses — every "GET a collection" route in
// v2, so a list is `{ items..., next_cursor }`. Wrapping the frozen document
// schemas rather than retyping their contents. ────────────────────────────
const tripsList = z.strictObject({ trips: z.array(tripDoc), next_cursor: z.string().optional() });
const daysList = z.strictObject({ trip: z.string(), days: z.array(dayDoc), next_cursor: z.string().optional() });
const mediaList = z.strictObject({ items: z.array(mediaItem), next_cursor: z.string().optional() });
const invitesList = z.strictObject({ invites: z.array(inviteDoc), next_cursor: z.string().optional() });
const contactsList = z.strictObject({ contacts: z.array(contactDoc), next_cursor: z.string().optional() });
const purchasesList = z.strictObject({ purchases: z.array(purchaseDoc), next_cursor: z.string().nullable() });
const ledgerList = z.strictObject({ ledger: z.array(ledgerRow), next_cursor: z.string().nullable() });
const figuresList = z.strictObject({ figures: z.array(figureDoc), next_cursor: z.string().optional() });

type Operation = {
  summary: string;
  request?: ReturnType<typeof jsonBody>;
  responses: Record<string, unknown>;
};

type PathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete", Operation>>;

function buildPaths(): Record<string, PathItem> {
  const paths: Record<string, PathItem> = {};

  // ── instance-level ────────────────────────────────────────────────────
  paths["/api/v2/openapi.json"] = {
    get: {
      summary: "This document. No auth.",
      responses: {
        ...jsonResponse(200, z.record(z.string(), z.unknown()), "the v2 OpenAPI 3.1 document"),
        ...noBodyResponse(405, "a verb this route does not answer"),
      },
    },
  };

  paths["/api/v2/status"] = {
    get: {
      summary: "What this instance can do, and what things cost. No auth.",
      responses: {
        ...jsonResponse(200, instanceStatus, "the instance's capabilities, limits and pricing"),
        ...noBodyResponse(405, "a verb this route does not answer"),
      },
    },
  };

  paths["/api/v2/journals/available"] = {
    get: {
      summary: "Whether a username is free to sign up with — send ?username=.",
      responses: {
        ...jsonResponse(200, usernameAvailability, "always 200 — availability is reported in the body, not the status"),
        ...refusalResponses([ref("invalid_request", 400, "no ?username= given")]),
      },
    },
  };

  paths["/api/v2/journals"] = {
    post: {
      summary: "Create a journal, spending a signup token minted by POST /api/auth/codes.",
      request: jsonBody(journalCreate, "the new journal's document"),
      responses: {
        ...jsonResponse(201, journalCreated, "the journal exists; a one-time sign-in link and the agent token ride along"),
        ...refusalResponses([
          ref("signup_disabled", 404),
          ref("too_many_requests", 429, "per-IP creation/refusal rate limit"),
          missingToken(),
          invalidToken(),
          ref("invalid_request", 400),
          ref("phone_required", 400),
          ref("invalid_username", 400),
          ref("deleted_username", 410),
          ref("reserved_username", 403),
          ref("username_taken", 409),
          ref("invalid_title", 400),
          ref("invalid_owner", 400),
          ref("too_many_journals", 403),
          ref("tel_taken", 409),
        ]),
      },
    },
  };

  paths["/api/v2/geocode"] = {
    post: {
      summary: "A place name into candidate coordinates, never a guess.",
      request: jsonBody(geocodeRequest, "a query, and optional hints"),
      responses: {
        ...jsonResponse(200, geocodeResponse, "a ranked shortlist, possibly empty"),
        ...refusalResponses([
          ...authRefusals,
          ref("address_lookup_disabled", 404),
          ref("invalid_request", 400),
          ref("too_many_requests", 429),
          ref("provider_unavailable", 502),
        ]),
      },
    },
  };

  // ── the journal document ────────────────────────────────────────────
  paths["/api/v2/{user}"] = {
    get: {
      summary: "The journal document.",
      responses: {
        ...jsonResponse(200, journalDoc, "the stored journal, with its ETag"),
        ...refusalResponses(ownerRefusals),
      },
    },
    patch: {
      summary: "Merge-patch the journal document.",
      request: jsonBody(journalPatch, "only the fields being changed"),
      responses: {
        ...jsonResponse(200, journalDoc, "the merged, re-validated document"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("stale_document", 409, "If-Match did not cover the current ETag"),
          ref("invalid_request", 400),
          ref("incomplete", 422, "the merged document leaves a required section neither answered nor declined"),
        ]),
      },
    },
    delete: {
      summary: "Ask to delete the journal — mails the owner a single-use confirmation link. Deletes nothing itself.",
      responses: {
        ...jsonResponse(202, deletionRequestedDoc("journal"), "a mail is on its way; nothing has been deleted"),
        ...refusalResponses([...ownerRefusals, ref("gone", 410, "already deleted"), ref("mail_disabled", 409)]),
      },
    },
  };

  paths["/api/v2/{user}/status"] = {
    get: {
      summary: "Where this journal and this token stand: drafts, trips, storage, inbox.",
      responses: {
        ...jsonResponse(200, journalStatus, "the journal's live status"),
        ...refusalResponses([...authRefusals, outOfScope(), noSuchJournal()]),
      },
    },
  };

  paths["/api/v2/{user}/storage"] = {
    get: {
      summary: "Where this journal's storage is going.",
      responses: {
        ...jsonResponse(200, storageDoc, "usage, breakdown, what could be reclaimed, and the price of more"),
        ...refusalResponses([...authRefusals, outOfScope(), noSuchJournal()]),
      },
    },
  };

  paths["/api/v2/{user}/channels"] = {
    get: {
      summary: "The owner's own mute switches for the sending channels.",
      responses: {
        ...jsonResponse(200, channelsDoc, "null for a channel this instance does not offer at all"),
        ...refusalResponses(ownerRefusals),
      },
    },
    patch: {
      summary: "Switch mail and/or WhatsApp sending on or off for this journal.",
      request: jsonBody(channelsPatch, "at least one of mail/whatsapp"),
      responses: {
        ...jsonResponse(200, channelsDoc, "the channels as they now stand"),
        ...refusalResponses([...ownerRefusals, ref("invalid_request", 400), ref("capability_unavailable", 409)]),
      },
    },
  };

  // ── trips ───────────────────────────────────────────────────────────
  paths["/api/v2/{user}/trips"] = {
    get: {
      summary: "Every trip this token may write, paged.",
      responses: {
        ...jsonResponse(200, tripsList, "one page of trip documents"),
        ...refusalResponses([...authRefusals, outOfScope(), noSuchJournal()]),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}"] = {
    get: {
      summary:
        "One trip. `?days=full|summaries|none` controls how much of each day rides along (default full, dayDoc[]); " +
        "summaries and none change the shape of `days` away from what `tripDoc` documents for a plain GET.",
      responses: {
        ...jsonResponse(200, tripDoc, "the trip, with its days inline (mode `full`)"),
        ...refusalResponses([...authRefusals, outOfScope(), noSuchJournal(), ref("unknown_trip", 404)]),
      },
    },
    put: {
      summary: "Create a trip at a client-chosen id, or replace one (with a matching If-Match).",
      request: jsonBody(tripCreate, "the whole trip document"),
      responses: {
        ...jsonResponse(201, tripDoc, "created"),
        ...jsonResponse(200, tripDoc, "replaced (If-Match matched the stored ETag)"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("invalid_trip_id", 400),
          ref("stale_document", 409, "exists already, with no or a stale If-Match — carries the stored document"),
          ref("invalid_request", 400),
          ref("incomplete", 422),
          ref("invalid_trip", 400),
          ref("invalid_translations", 400),
          ref("invalid_cover", 400),
        ]),
      },
    },
    patch: {
      summary: "Merge-patch a trip.",
      request: jsonBody(tripPatch, "only the fields being changed"),
      responses: {
        ...jsonResponse(200, tripDoc, "the merged, re-validated document"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("unknown_trip", 404),
          ref("stale_document", 409),
          ref("invalid_request", 400),
          ref("incomplete", 422),
          ref("invalid_translations", 400),
          ref("invalid_cover", 400),
        ]),
      },
    },
    delete: {
      summary: "Ask to delete a trip — mails the owner a single-use confirmation link. Deletes nothing itself.",
      responses: {
        ...jsonResponse(202, deletionRequestedDoc("trip"), "a mail is on its way; nothing has been deleted"),
        ...refusalResponses([...ownerRefusals, ref("gone", 410)]),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}/days"] = {
    get: {
      summary: "Every day in this trip, paged.",
      responses: {
        ...jsonResponse(200, daysList, "one page of day documents"),
        ...refusalResponses(tripWriteRefusals),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}/days/{slug}"] = {
    get: {
      summary: "One day.",
      responses: {
        ...jsonResponse(200, dayDoc, "the day, with its ETag"),
        ...refusalResponses([...tripWriteRefusals, ref("unknown_day", 404)]),
      },
    },
    put: {
      summary: "Create a day at a client-chosen slug, or replace a draft (with a matching If-Match).",
      request: jsonBody(dayWrite, "the whole day document"),
      responses: {
        ...jsonResponse(201, dayDoc, "created"),
        ...jsonResponse(200, dayDoc, "replaced"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("invalid_request", 400),
          ref("stale_document", 409),
          ref("already_published", 409, "PUT replaces a draft only; PATCH a published day"),
          ref("weather_disabled", 400),
          ref("incomplete", 422),
          ref("invalid_entry", 400),
          ref("invalid_translations", 400),
        ]),
      },
    },
    patch: {
      summary: "Merge-patch a day. Never moves it between draft and published.",
      request: jsonBody(dayPatch, "only the fields being changed"),
      responses: {
        ...jsonResponse(200, dayDoc, "the merged, re-validated document"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("unknown_day", 404),
          ref("stale_document", 409),
          ref("invalid_request", 400),
          ref("weather_disabled", 400),
          ref("incomplete", 422),
          ref("invalid_entry", 400),
          ref("invalid_translations", 400),
        ]),
      },
    },
    delete: {
      summary: "Delete a draft day outright — no confirmation step, since it was never on the site.",
      responses: {
        ...jsonResponse(200, dayDeleted, "deleted; its media is kept on disk"),
        ...refusalResponses([...tripWriteRefusals, ref("unknown_day", 404), ref("published_day_not_deletable", 409)]),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}/days/{slug}/publish"] = {
    post: {
      summary: "Owner only: put a draft day on the site.",
      request: jsonBody(publishRequest, "which tracked facts to decline, and whether to send it"),
      responses: {
        ...jsonResponse(200, dayPublished, "published"),
        ...jsonResponse(200, dayPublishPreview, "dryRun — nothing written"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("out_of_scope", 403, "a trip-scoped token cannot publish"),
          ref("unknown_day", 404),
          ref("already_published", 409),
          ref("invalid_request", 400),
          ref("incomplete_day", 422),
          ref("no_credits", 402),
        ]),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}/days/{slug}/unpublish"] = {
    post: {
      summary: "Owner only: take a published day off the site. Reversible by publishing again.",
      responses: {
        ...jsonResponse(200, dayUnpublished, "off the site"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("out_of_scope", 403, "a trip-scoped token cannot unpublish"),
          ref("unknown_day", 404),
          ref("already_draft", 409),
        ]),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}/days/{slug}/send"] = {
    post: {
      summary: "Owner only: send (or resend) a published day by mail and/or WhatsApp. The one send door.",
      request: jsonBody(sendRequest, "which channels to send on"),
      responses: {
        ...jsonResponse(200, daySendResult, "per-channel send summaries"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("out_of_scope", 403, "a trip-scoped token cannot send"),
          ref("unknown_day", 404),
          ref("not_published", 409),
          ref("test_content", 409),
          ref("invalid_request", 400),
          ref("no_credits", 402),
        ]),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}/costs/apply"] = {
    post: {
      summary: "Write agreed bank-statement rows onto the days they belong to.",
      request: jsonBody(costsApplyRequest, "the rows a person agreed, from GET .../statements/{src}"),
      responses: {
        ...jsonResponse(200, costsApplyResult, "how many rows landed, and which dates had no day yet"),
        ...refusalResponses([...tripWriteRefusals, ref("invalid_costs", 400)]),
      },
    },
  };

  // ── media (one door for every kind of bytes) ───────────────────────
  paths["/api/v2/{user}/media"] = {
    get: {
      summary: "One trip's stored media, paged — send ?trip=.",
      responses: {
        ...jsonResponse(200, mediaList, "one page of media items"),
        ...refusalResponses([...authRefusals, outOfScope(), ref("invalid_request", 400), ref("unknown_trip", 404), forbidden()]),
      },
    },
    post: {
      summary:
        "Upload bytes: JSON `{intent, url|inbox}` fetching/resolving the bytes, or `multipart/form-data` with `file` and `intent`. " +
        `\`intent.kind\` is one of ${MEDIA_KINDS.join(", ")}.`,
      request: jsonBody(mediaIntent, "the JSON form's `intent` field — the multipart form carries the same shape as a form field"),
      responses: {
        ...jsonResponse(201, mediaItem, "stored"),
        ...refusalResponses([
          ...authRefusals,
          outOfScope(),
          ref("invalid_request", 400),
          ref("unknown_trip", 404),
          forbidden(),
          ref("expected_urls", 400),
          ref("unknown_inbox_file", 400),
          ref("could_not_fetch", 400),
          ref("body_too_large", 413),
          ref("expected_multipart", 400),
          ref("storage_full", 400),
          ref("invalid_media", 400),
        ]),
      },
    },
    delete: {
      summary: "Remove a stored media item by its src.",
      responses: {
        ...jsonResponse(200, mediaDeleted, "removed"),
        ...refusalResponses([
          ...authRefusals,
          outOfScope(),
          ref("invalid_request", 400),
          forbidden(),
          ref("unknown_media", 404),
        ]),
      },
    },
  };

  // ── inbox ───────────────────────────────────────────────────────────
  paths["/api/v2/{user}/inbox"] = {
    get: {
      summary: "Files staged with no trip/day yet.",
      responses: { ...jsonResponse(200, inboxList, "counts and items, by shelf"), ...refusalResponses(ownerRefusals) },
    },
  };
  paths["/api/v2/{user}/inbox/{id}"] = {
    delete: {
      summary: "Discard one staged file. No confirmation — nothing here has ever been on the site.",
      responses: {
        ...jsonResponse(200, inboxDeleted, "removed"),
        ...refusalResponses([...ownerRefusals, ref("not_found", 404)]),
      },
    },
  };

  // ── figures ─────────────────────────────────────────────────────────
  paths["/api/v2/{user}/figures"] = {
    get: {
      summary: "Every figure in the journal's library, paged.",
      responses: { ...jsonResponse(200, figuresList, "one page of figures"), ...refusalResponses(ownerRefusals) },
    },
  };
  paths["/api/v2/{user}/figures/{id}"] = {
    get: {
      summary: "One figure.",
      responses: { ...jsonResponse(200, figureDoc, "the figure"), ...refusalResponses([...ownerRefusals, ref("not_found", 404)]) },
    },
    put: {
      summary: "Create a figure at a client-chosen id, or replace one (with a matching If-Match).",
      request: jsonBody(figureDoc, "the whole figure document"),
      responses: {
        ...jsonResponse(201, figureDoc, "created"),
        ...jsonResponse(200, figureDoc, "replaced"),
        ...refusalResponses([...ownerRefusals, ref("invalid_request", 400), ref("stale_document", 409)]),
      },
    },
    delete: {
      summary: "Delete a figure — refused while any trip or the journal's own default set still names it.",
      responses: {
        ...jsonResponse(200, figureDeleted, "deleted"),
        ...refusalResponses([...ownerRefusals, ref("not_found", 404), ref("figure_referenced", 409)]),
      },
    },
  };
  paths["/api/v2/{user}/figures/presets"] = {
    get: {
      summary: "The whole vocabulary a figure may be described in, and starting points.",
      responses: { ...jsonResponse(200, figurePresets, "the vocabulary"), ...refusalResponses([noSuchJournal()]) },
    },
  };
  paths["/api/v2/{user}/figures/preview"] = {
    get: {
      summary: "Draw one figure (?figure=) or a party (?party=) as an SVG, so a person can confirm it before it is written.",
      responses: {
        ...svgResponse(200, "an SVG drawing"),
        ...refusalResponses([noSuchJournal(), ref("nothing_to_draw", 400), ref("invalid_json", 400)]),
      },
    },
  };

  // ── money ───────────────────────────────────────────────────────────
  paths["/api/v2/{user}/purchases"] = {
    get: {
      summary: "This journal's purchase history, paged.",
      responses: { ...jsonResponse(200, purchasesList, "one page of purchases"), ...refusalResponses([...ownerRefusals, ref("credits_disabled", 404)]) },
    },
  };
  paths["/api/v2/{user}/purchases/{id}"] = {
    get: {
      summary: "One purchase.",
      responses: {
        ...jsonResponse(200, purchaseDoc, "the purchase"),
        ...refusalResponses([...ownerRefusals, ref("credits_disabled", 404), ref("unknown_payment", 404)]),
      },
    },
    put: {
      summary:
        "Propose buying credits at a client-chosen id. Files a pending transaction and mails the owner — grants nothing itself.",
      request: jsonBody(purchaseCreate, "the amount of credits wanted"),
      responses: {
        ...jsonResponse(201, purchaseDoc, "created; mail sent"),
        ...jsonResponse(200, purchaseDoc, "the same id was already this exact amount — a no-op re-read"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("credits_disabled", 404),
          ref("too_many_requests", 429),
          ref("invalid_amount", 400),
          ref("no_owner_address", 409),
          ref("no_database", 503),
          ref("conflict", 409, "the id exists with a different amount"),
        ]),
      },
    },
  };
  paths["/api/v2/{user}/credits/ledger"] = {
    get: {
      summary: "This journal's credit ledger, paged.",
      responses: { ...jsonResponse(200, ledgerList, "one page of ledger rows"), ...refusalResponses([...ownerRefusals, ref("credits_disabled", 404)]) },
    },
  };

  // ── contacts, invites, channels ─────────────────────────────────────
  paths["/api/v2/{user}/contacts"] = {
    get: {
      summary: "The contacts queue.",
      responses: { ...jsonResponse(200, contactsList, "one page of contacts — no address, no consent booleans"), ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409)]) },
    },
    post: {
      summary: "File a pending contact and mail it a confirmation link.",
      request: jsonBody(contactCreate, "a name and an email"),
      responses: {
        ...jsonResponse(201, contactDoc, "pending"),
        ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("invalid_request", 400), ref("contact_exists", 409)]),
      },
    },
  };
  paths["/api/v2/{user}/contacts/import"] = {
    post: {
      summary: "File many pending contacts at once, from rows a person already agreed.",
      request: jsonBody(z.strictObject({ rows: z.array(z.record(z.string(), z.unknown())).min(1) }), "{rows: [{name, email, tel?}, ...]}"),
      responses: {
        ...jsonResponse(200, contactImportResult, "per-row outcomes"),
        ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("invalid_request", 400)]),
      },
    },
  };
  paths["/api/v2/{user}/contacts/self"] = {
    post: {
      summary: "Add the owner as their own contact, from this journal's own config.json.",
      responses: {
        ...jsonResponse(200, contactSelfResult, "added, or already present"),
        ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("invalid_request", 409)]),
      },
    },
  };
  paths["/api/v2/{user}/contacts/{id}"] = {
    get: {
      summary: "One contact.",
      responses: { ...jsonResponse(200, contactDoc, "the contact"), ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("unknown_contact", 404)]) },
    },
    patch: {
      summary: "Correct a contact's name, email or locale. Never its status.",
      request: jsonBody(contactPatch, "only the fields being changed"),
      responses: {
        ...jsonResponse(200, contactDoc, "the corrected contact"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("contacts_disabled", 409),
          ref("unknown_contact", 404),
          ref("invalid_request", 400),
          ref("self_authored", 409),
        ]),
      },
    },
    delete: {
      summary: "Delete a contact.",
      responses: {
        ...jsonResponse(200, contactDeleted, "deleted"),
        ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("unknown_contact", 404)]),
      },
    },
  };
  paths["/api/v2/{user}/contacts/{id}/approve"] = {
    post: {
      summary: "Grant a confirmed contact access — the only thing that writes an access grant.",
      responses: {
        ...jsonResponse(200, contactActionResult, "approved; which trips opened"),
        ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("unknown_contact", 404), ref("not_confirmed", 409)]),
      },
    },
  };
  paths["/api/v2/{user}/contacts/{id}/revoke"] = {
    post: {
      summary: "Revoke a contact's access. Reversible by approving again.",
      responses: {
        ...jsonResponse(200, contactActionResult, "revoked"),
        ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("unknown_contact", 404)]),
      },
    },
  };
  paths["/api/v2/{user}/contacts/{id}/resend"] = {
    post: {
      summary: "Re-mail a pending contact's invite link.",
      responses: {
        ...jsonResponse(200, contactSendResult, "resent"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("contacts_disabled", 409),
          ref("unknown_contact", 404),
          ref("invalid_request", 409),
          ref("too_many_requests", 429),
        ]),
      },
    },
  };

  paths["/api/v2/{user}/invites"] = {
    get: {
      summary: "Every invite link this journal has issued, paged.",
      responses: { ...jsonResponse(200, invitesList, "one page of invites"), ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409)]) },
    },
  };
  paths["/api/v2/{user}/invites/{id}"] = {
    get: {
      summary: "One invite.",
      responses: { ...jsonResponse(200, inviteDoc, "the invite"), ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("not_found", 404)]) },
    },
    put: {
      summary: "Create a guest or buddy link at a client-chosen id. An invite has no update once created.",
      request: jsonBody(inviteWrite, "the invite to create"),
      responses: {
        ...jsonResponse(201, inviteCreated, "created — `url` is the link, present only in this response"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("contacts_disabled", 409),
          ref("invalid_request", 400),
          ref("stale_document", 409),
          ref("unknown_trip", 404),
        ]),
      },
    },
    delete: {
      summary: "Revoke an invite link. Does not remove anybody already approved through it.",
      responses: {
        ...jsonResponse(200, inviteRevoked, "revoked"),
        ...refusalResponses([...ownerRefusals, ref("contacts_disabled", 409), ref("not_found", 404)]),
      },
    },
  };

  // ── statements & postcards & photobooks ────────────────────────────
  paths["/api/v2/{user}/statements/{src}"] = {
    get: {
      summary: "Read a staged bank export as a report — writes nothing.",
      responses: {
        ...jsonResponse(200, statementRead, "merchants, payments and rates"),
        ...refusalResponses([...ownerRefusals, ref("unknown_statement", 404), ref("unreadable_statement", 400)]),
      },
    },
  };

  paths["/api/v2/{user}/postcards/recipients"] = {
    get: {
      summary: "Who a postcard may be addressed to — a name, town and country, never a street.",
      responses: {
        ...jsonResponse(200, postcardRecipients, "eligible recipients"),
        ...refusalResponses([ref("postcards_disabled", 404), ...ownerRefusals]),
      },
    },
  };
  paths["/api/v2/{user}/postcards/texts"] = {
    get: {
      summary: "Prefill material for a card's message — every day's opening line, per locale. Send ?trip=.",
      responses: {
        ...jsonResponse(200, postcardTexts, "opening lines by day and locale"),
        ...refusalResponses([ref("postcards_disabled", 404), ...ownerRefusals, ref("unknown_trip", 404)]),
      },
    },
  };
  paths["/api/v2/{user}/postcards/orders/{id}"] = {
    get: {
      summary: "One postcard order.",
      responses: {
        ...jsonResponse(200, postcardOrderDoc, "the order"),
        ...refusalResponses([ref("postcards_disabled", 404), ref("contacts_disabled", 404), ...ownerRefusals, ref("unknown_order", 404)]),
      },
    },
    put: {
      summary: "Propose a postcard order at a client-chosen id. Charges nothing and prints nothing — the owner presses Send.",
      request: jsonBody(postcardOrderWrite, "the whole order proposal"),
      responses: {
        ...jsonResponse(201, postcardOrderDoc, "proposed"),
        ...jsonResponse(200, postcardOrderDoc, "the id already exists — echoed back, nothing rewritable through this door"),
        ...refusalResponses([
          ref("postcards_disabled", 404),
          ref("contacts_disabled", 404),
          ...ownerRefusals,
          ref("stale_document", 409),
          ref("invalid_request", 400),
          ref("unknown_photo", 404),
          ref("unknown_trip", 404),
          ref("unknown_day", 404),
          ref("test_content", 400),
          ref("unknown_recipient", 404),
          ref("no_database", 503),
        ]),
      },
    },
  };
  paths["/api/v2/{user}/photobooks/orders/{id}"] = {
    get: {
      summary: "One photobook order. Read-only — building and paying for a book is browser-only.",
      responses: {
        ...jsonResponse(200, photobookOrderDoc, "the order"),
        ...refusalResponses([ref("photobook_disabled", 404), ...ownerRefusals, ref("unknown_order", 404)]),
      },
    },
  };

  return paths;
}

export function openApiDocumentV2() {
  const site = serverSite();
  const example = getDefaultUsername() ?? listedUsernames()[0] ?? "username";

  return {
    openapi: "3.1.0",
    info: {
      title: `${site.name} — v2 API`,
      version: "2",
      description:
        "Generated from the frozen Zod contract in lib/api/v2/schemas/ — every field, enum and required/optional " +
        "marker here is what a validator actually checks, not a second hand-typed copy of it. " +
        `Every path below is relative to ${site.url}, and every "{user}" is a journal's username (e.g. "${example}").`,
    },
    servers: [{ url: site.url }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "An agent token from POST /api/auth/codes + /verify." },
      },
    },
    paths: buildPaths(),
  };
}
