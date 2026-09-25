import "server-only";
import { z } from "zod";
import { serverSite } from "../../site";
import { getDefaultUsername, listedUsernames, USERNAME_RE } from "../../users";
import { ERROR_CODES } from "../errorCodes";
import { V2_ONLY_CODES } from "./route";
import { JSON_BODY_MAX_BYTES } from "../jsonBody";
import { REMINDER_CHANNELS, ID_RE } from "../../tripWrite";
import type { Declinable } from "./schemas/shared";
import {
  dayDoc,
  dayWrite,
  dayPatch,
  daySlug,
  DAY_DECLINABLES,
  tripCreate,
  tripPatch,
  tripDoc,
  TRIP_DECLINABLES,
  publishRequest,
  sendRequest,
  journalDoc,
  journalWrite,
  journalPatch,
  mediaIntent,
  mediaItem,
  MEDIA_KINDS,
  dayMediaAttachRequest,
  dayMediaDetachRequest,
  instanceStatus,
  journalStatus,
  figureDoc,
  purchaseCreate,
  purchaseDoc,
  ledgerRow,
  errorEnvelope,
  geocodeRequest,
  geocodeResponse,
  gpsZonesWrite,
  gpsZonesDoc,
  journalCreate,
  postcardOrderWrite,
  postcardOrderDoc,
  photobookDraftWrite,
  photobookDraftDoc,
  statementRead,
  costsApplyRequest,
  inboxList,
  contactDoc,
  channelsPatch,
  channelsDoc,
  ownerTelDoc,
  ownerTelVerifyRequest,
  ownerTelVerifyStarted,
  ownerTelVerifyRedeem,
  ownerEmailPending,
  ownerEmailRedeem,
  dayMoveRequest,
  dayMoveResult,
  daySplitRequest,
  daySplitResult,
  dayMergeRequest,
  dayMergeResult,
  tripRenameRequest,
  tripRenameResult,
  gpsMonthsDoc,
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
import { BOOK_SIZES, COVER_TYPES } from "@paid/photobook/lib/photobook/spec";
import { EXTRA_STORAGE_BYTES, EXTRA_STORAGE_CREDITS, POSTCARD_CREDITS } from "@paid/credits/lib/credits/pricing";
import { HELPER_PROVIDER, TRAVELLERS_FROM_PHOTO_CREDITS } from "../../helper/model";
import { IMPORT_KINDS } from "../../gps/api";
import { PAID_AREAS } from "@paid/manifest";
import { CODE_TTL_MINUTES, GPS_TOKEN_TTL_DAYS, HANDOVER_TTL_MINUTES } from "../../auth";
import {
  CREDENTIAL_FOR,
  codesRequest,
  codesRequestResponse,
  codesRedeemRequest,
  codesRedeemCookieResponse,
  codesRedeemTokenResponse,
  linksRedeemRequest,
  linksRedeemResponse,
} from "./schemas/auth";

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

/**
 * Layers the asked-or-declined rule onto a generated body schema — B1648.
 * `checkRequiredOrDeclined` (lib/api/v2/schemas/shared.ts) enforces, at
 * write time, that every declinable section is either present or named in
 * `declined`; every one of those fields is `.optional()` in the Zod shape
 * itself (declining it is exactly as valid as answering it), so
 * `z.toJSONSchema()` alone describes a document with no requirements where
 * the server in fact refuses several of them as `422 incomplete`. Adding
 * `status` to a hand-typed `required` array would drift the moment a
 * fifteenth declinable is added — so this reads the same exported list the
 * runtime check reads (`DAY_DECLINABLES`/`TRIP_DECLINABLES`) and expresses
 * it as an ordinary JSON Schema constraint per field: the field itself, or a
 * `declined.<field>` entry, one of the two. `x-required-or-declined` repeats
 * the same list in the words `checkRequiredOrDeclined` actually raises
 * (`whyRequired`), for a reader that wants the reason rather than the
 * constraint.
 */
function withRequiredOrDeclined(
  schema: Record<string, unknown>,
  declinables: readonly Declinable[],
): Record<string, unknown> {
  return {
    ...schema,
    "x-required-or-declined": declinables.map((d) => ({
      field: d.field,
      whyRequired: d.whyRequired,
      toDecline: `declined.${d.field}`,
    })),
    allOf: [
      ...((schema.allOf as unknown[] | undefined) ?? []),
      ...declinables.map((d) => ({
        anyOf: [
          { required: [d.field] },
          { required: ["declined"], properties: { declined: { required: [d.field] } } },
        ],
      })),
    ],
  };
}

const jsonBody = (schema: z.ZodType, description?: string, declinables?: readonly Declinable[]) => ({
  description: description ?? "",
  required: true,
  content: {
    "application/json": {
      schema: declinables ? withRequiredOrDeclined(schemaOf(schema), declinables) : schemaOf(schema),
    },
  },
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

/** `paid/photobook/lib/photobook/orders.ts` keeps `status` as a plain `string` column with
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
      channels: z.array(z.strictObject({ channel: z.enum(REMINDER_CHANNELS), url: z.string() })),
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
  written: z.array(
    z.strictObject({
      date: z.string(),
      slug: z.string(),
      added: z.number().int().nonnegative(),
      kept: z.number().int().nonnegative(),
    }),
  ),
  // B1844 — a date with no day written is not dropped: the rows are filed
  // onto the trip's own `costs.items` instead, and this lists which dates
  // that happened for.
  filedToTrip: z.array(z.strictObject({ date: z.string(), rows: z.number().int().positive() })),
  message: z.string(),
  next: z.string().optional(),
});

const mediaDeleted = z.strictObject({ ok: z.literal(true), src: z.string() });

const inboxDeleted = z.strictObject({ ok: z.literal(true), id: z.string(), filename: z.string() });

const figureDeleted = z.strictObject({ deleted: z.string(), dryRun: z.boolean().optional() });

const contactSelfResult = z.strictObject({ ok: z.literal(true), contact: contactDoc.optional(), dryRun: z.boolean().optional() });

const contactImportResult = z.strictObject({
  filed: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  results: z.array(z.record(z.string(), z.unknown())),
  next: z.string(),
});

/**
 * `next` is not a field of `tripDoc`/`dayDoc` themselves — a plain `GET`
 * never carries it — but the first `PUT` of a journal's first trip, and the
 * first `PUT` of a trip's first day, echo one alongside the document: B311's
 * chain, journal → trip → day → photographs, so an agent that has just
 * created its first of either is told where the next step is written down
 * rather than left to guess (`app/api/v2/[user]/trips/[trip]/route.ts`,
 * `.../days/[slug]/route.ts`). Documented here as its own response shape,
 * wrapping the frozen document rather than adding an unconditional field to it.
 */
const tripCreatedFirst = z.object({ ...tripDoc.shape, next: z.string().optional() });
const dayCreatedFirst = z.object({ ...dayDoc.shape, next: z.string().optional() });

// ── pagination-wrapped list responses — every "GET a collection" route in
// v2, so a list is `{ items..., next_cursor }`. Wrapping the frozen document
// schemas rather than retyping their contents. ────────────────────────────
const tripsList = z.strictObject({ trips: z.array(tripDoc), next_cursor: z.string().optional() });
const daysList = z.strictObject({ trip: z.string(), days: z.array(dayDoc), next_cursor: z.string().optional() });
const mediaList = z.strictObject({ items: z.array(mediaItem), next_cursor: z.string().optional() });
const purchasesList = z.strictObject({ purchases: z.array(purchaseDoc), next_cursor: z.string().nullable() });
const ledgerList = z.strictObject({ ledger: z.array(ledgerRow), next_cursor: z.string().nullable() });
const figuresList = z.strictObject({ figures: z.array(figureDoc), next_cursor: z.string().optional() });

// ── the sync surface (B1495) — a journal's own folder, mirrorable ────────
const syncManifestEntry = z.strictObject({ path: z.string(), size: z.number().int().nonnegative(), hash: z.string() });
const syncManifest = z.strictObject({
  user: z.string(),
  files: z.array(syncManifestEntry),
  bytes: z.number().int().nonnegative(),
  next: z.string(),
});

// ── the identity surface (B411) — an address's own device list, not a
// journal's; no {user} in either path. ────────────────────────────────────
const homeDevice = z.strictObject({
  id: z.string(),
  publicId: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
const homeJournal = z.strictObject({
  username: z.string(),
  title: z.string(),
  tagline: z.string(),
  href: z.string(),
  role: z.enum(["admin", "owner", "traveller", "guest"]),
  trips: z.array(z.record(z.string(), z.unknown())),
});
const homeDoc = z.strictObject({
  id: z.string().nullable(),
  email: z.string().nullable(),
  admin: z.boolean(),
  journals: z.array(homeJournal),
  devices: z.array(homeDevice),
});
const deviceRevoked = z.strictObject({ ok: z.literal(true), current: z.boolean() });

// ── importing somebody's own data (B671) — gps and contacts only; a bank
// statement moved to the media/statements doors in B1624. ────────────────
const importDoor = z.strictObject({
  kind: z.enum(IMPORT_KINDS),
  what: z.string(),
  formats: z.array(z.strictObject({ id: z.string(), label: z.string() })),
});
const importGetDoc = z.strictObject({
  user: z.string(),
  kinds: z.array(importDoor),
  maxBytes: z.number().int().positive(),
  next: z.string(),
});
const gpsImportResult = z.strictObject({
  kind: z.literal("gps"),
  format: z.string(),
  detected: z.boolean(),
  read: z.number().int().nonnegative(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  stored: z
    .strictObject({
      read: z.number().int().nonnegative(),
      /** Owner only — a `write:gps` caller is not told what was already held. */
      before: z.number().int().nonnegative().optional(),
      after: z.number().int().nonnegative().optional(),
      months: z.array(z.string()),
    })
    .optional(),
  /** Owner only — B2202: trips whose dates overlap this import, re-derived
   * on the spot. Per-trip ok/fail, never a coordinate. */
  rederived: z.array(z.strictObject({ tripId: z.string(), ok: z.boolean() })).optional(),
  dryRun: z.boolean(),
  next: z.string(),
});
const contactsImportResult = z.strictObject({
  kind: z.literal("contacts"),
  format: z.string(),
  detected: z.boolean(),
  people: z.array(z.strictObject({ name: z.string(), email: z.string().optional(), tel: z.string().optional() })),
  withEmail: z.number().int().nonnegative(),
  next: z.string(),
});

// ── the same photograph twice (B1103) ─────────────────────────────────────
const duplicateMediaItem = z.strictObject({
  src: z.string(),
  day: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative(),
});
const duplicatesDoc = z.strictObject({
  ok: z.literal(true),
  groups: z.array(z.array(duplicateMediaItem)),
  note: z.string(),
});

// ── reading a party off a photograph (B1517) — proposed, never written, so
// this is the figure's appearance alone: no id (nothing is stored), no
// name and no person (this call never matches a face to somebody). ──────
const figureAppearance = figureDoc.omit({ id: true, name: true, person: true });
const fromPhotoResult = z.strictObject({
  ok: z.literal(true),
  figures: z.array(
    z.strictObject({
      position: z.number().int().nonnegative(),
      figure: figureAppearance,
      unanswerable: z.array(z.string()),
    }),
  ),
  party: z.array(figureAppearance),
  preview: z.string(),
  spent: z.literal(TRAVELLERS_FROM_PHOTO_CREDITS),
  provider: z.literal(HELPER_PROVIDER),
  note: z.string(),
});

// ── the sign-in doors under /api/auth (B1734) — no schema of their own in
// lib/api/v2/schemas/: `codes`, `codes/redeem` and `links/redeem` use
// auth.ts's schemas above; these five shapes exist only here because
// nothing else in the codebase needs to import them. ──────────────────────
const phoneStartResponse = z.union([
  z.strictObject({ status: z.literal("accepted"), id: z.string(), next: z.string() }),
  z.strictObject({
    status: z.literal("accepted"),
    mode: z.literal("whatsapp-inbound"),
    smsFallback: z.boolean(),
    id: z.string(),
    link: z.string(),
    text: z.string(),
    next: z.string(),
  }),
]);
const phoneRedeemRequest = z.strictObject({ id: z.string(), code: z.string().optional() });
const phoneRedeemResponse = z.union([
  z.strictObject({ status: z.enum(["pending", "expired"]) }),
  z.strictObject({ ok: z.literal(true), tel: z.string(), next: z.string() }),
]);
const handoverIssued = z.strictObject({
  ok: z.literal(true),
  handover: z.string(),
  expiresAt: z.string(),
  minutes: z.number(),
  exchange: z.string(),
  next: z.string(),
});
const handoverExchanged = z.strictObject({
  ok: z.literal(true),
  token: z.string(),
  expiresAt: z.string(),
  scope: z.literal("write:content"),
  user: z.string(),
  journal: z.string(),
  status: z.string(),
  next: z.string(),
});
const gpsTokenIssued = z.strictObject({
  ok: z.literal(true),
  token: z.string(),
  expiresAt: z.string(),
  scope: z.literal("write:gps"),
  days: z.number(),
  next: z.string(),
});
const keysList = z.strictObject({
  user: z.string(),
  keys: z.array(
    z.strictObject({
      id: z.string(),
      kind: z.enum(["write", "handover"]),
      createdAt: z.string(),
      expiresAt: z.string(),
      lastSeenAt: z.string().nullable(),
      // "gps" — B2204 — is a live `write:gps` token: a phone uploading
      // positions, never anything else. The keys page labels it plainly
      // rather than the "owner"/"trip" translation every other row gets.
      scope: z.enum(["owner", "trip", "gps"]),
      trip: z.string().optional(),
      email: z.string().optional(),
    }),
  ),
});
const keyRevoked = z.strictObject({ ok: z.literal(true), revoked: z.string() });

type Operation = {
  summary: string;
  requestBody?: ReturnType<typeof jsonBody>;
  responses: Record<string, unknown>;
};

type PathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete", Operation>> & {
  parameters?: unknown[];
};

/**
 * What each templated segment of a path is — B1720.
 *
 * Every path in this document carries holes (`{user}`, `{trip}`, `{slug}`,
 * `{id}`, `{src}`, `{path}`) and, until this, declared them nowhere: OpenAPI
 * requires a `parameters` entry per hole, and there were none, so a generated
 * client had no type, no pattern and no sentence for the values it has to
 * substitute — it could read every door and not build a single URL. Redocly
 * counted 100 of them; the JSON-Schema validation passed, because the
 * requirement is in the specification's prose rather than in its schema, which
 * is exactly why nothing caught it.
 *
 * **One vocabulary, keyed by the name in the path.** The parameters are
 * generated by walking the path string itself, so a new templated segment
 * cannot arrive undeclared — the emitter sees it whether or not anybody
 * remembered. A name with no entry here still produces a valid parameter, and
 * `test/openapi-v2-contract.test.ts` fails until it gets a real one: a
 * document that keeps working while the gate goes red is better than one that
 * throws at build time over a description.
 *
 * The patterns are read from where the server enforces them —
 * `USERNAME_RE` in lib/users.ts, the trip id and day slug out of the Zod
 * schemas below — rather than typed a second time here.
 */
const PATH_PARAMETERS: Record<string, { schema: Record<string, unknown>; description: string }> = {
  user: {
    schema: { type: "string", pattern: USERNAME_RE.source },
    description:
      "The journal's own name. It is a directory name and a URL segment at once, which is why " +
      "the pattern is strict and why a name that would shadow a route of this site is refused.",
  },
  trip: {
    schema: { type: "string", pattern: ID_RE.source },
    description:
      "The trip's id, chosen by the client that created it and never writable afterwards: it is " +
      "the trip's folder name and the URL people share.",
  },
  slug: {
    schema: { type: "string", pattern: daySlug.source },
    description:
      "The day's slug — `YYYY-MM-DD-something`. It is the day's filename, its address here, and " +
      "the only identity it has; the date in it is the day's own date.",
  },
  id: {
    schema: { type: "string", minLength: 1 },
    description:
      "The id of the thing this path addresses — a figure, an invite, a contact, an order, a " +
      "credential. Client-chosen where the door creates at a client-chosen id, server-issued " +
      "otherwise; either way it comes back in the answer that made it.",
  },
  src: {
    schema: { type: "string", minLength: 1 },
    description:
      "A stored media item's `src`, exactly as a day or the media list gives it — " +
      "`/media/<trip>/<day>/<name>`. URL-encode it: it contains slashes.",
  },
  token: {
    schema: { type: "string", minLength: 1 },
    description:
      "The single-use confirmation token from the deletion mail. A person receives it by " +
      "email and it lasts an hour; nothing an agent can mint, guess or be given, which is " +
      "the whole point — the first call only asks for the mail to be sent, and this is the " +
      "second, human half.",
  },
  path: {
    schema: { type: "string", minLength: 1 },
    description:
      "A file's path inside the journal folder, exactly as the sync manifest lists it — " +
      "`trips/<trip>/entries/<slug>.json`. Never absolute, and never climbing out of the folder.",
  },
};

/** The `parameters` block for one path, derived from the path itself. */
function parametersFor(path: string): unknown[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => {
    const known = PATH_PARAMETERS[name];
    return {
      name,
      in: "path",
      required: true,
      schema: known?.schema ?? { type: "string", minLength: 1 },
      ...(known ? { description: known.description } : {}),
    };
  });
}

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
      requestBody: jsonBody(journalCreate, "the new journal's document"),
      responses: {
        ...jsonResponse(201, journalCreated, "the journal exists; a one-time sign-in link and the agent token ride along"),
        ...refusalResponses([
          ref("signup_disabled", 404),
          ref("signup_not_invited", 403, "this instance is invite-only and the address is not on its list"),
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

  // ── the identity surface — an address, not a journal; no {user} ───────
  paths["/api/v2/me/home"] = {
    get: {
      summary: "What this address may open, and its own device list. No bearer token — an fs_identity cookie, or nobody.",
      responses: {
        ...jsonResponse(200, homeDoc, "always 200 — `id: null` is a stranger, not a refusal"),
        ...noBodyResponse(405, "a verb this route does not answer"),
      },
    },
  };
  paths["/api/v2/me/devices/{id}"] = {
    delete: {
      summary: "End one device's identity. The id is checked against this address's own list.",
      responses: {
        ...jsonResponse(200, deviceRevoked, "revoked"),
        ...refusalResponses([ref("auth_disabled", 404), ref("not_signed_in", 401), ref("no_such_device", 404)]),
      },
    },
  };

  paths["/api/v2/geocode"] = {
    post: {
      summary: "A place name into candidate coordinates, never a guess.",
      requestBody: jsonBody(geocodeRequest, "a query, and optional hints"),
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
      summary:
        "Merge-patch the journal document. A CHANGED owner.email does not write — it starts a " +
        "verification at `.../owner/email/redeem` instead, and answers 202.",
      requestBody: jsonBody(journalPatch, "only the fields being changed"),
      responses: {
        ...jsonResponse(200, journalDoc, "the merged, re-validated document"),
        ...jsonResponse(
          202,
          ownerEmailPending,
          "owner.email changed to a different, valid address — a code went to it, and nothing was written",
        ),
        ...refusalResponses([
          ...ownerRefusals,
          ref("stale_document", 409, "If-Match did not cover the current ETag"),
          ref("invalid_request", 400),
          ref("incomplete", 422, "the merged document leaves a required section neither answered nor declined"),
          ref("mail_disabled", 503, "owner.email changed, but this server cannot send the verification code"),
          ref("mail_failed", 503, "owner.email changed, but the verification code could not be sent"),
          ref("too_many_requests", 429, "too many owner-email codes for this address or this journal today"),
        ]),
      },
    },
    delete: {
      summary: "Ask to delete the journal — mails the owner a single-use confirmation link. Deletes nothing itself.",
      responses: {
        ...jsonResponse(202, deletionRequestedDoc("journal"), "a mail is on its way; nothing has been deleted"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("gone", 410, "already deleted"),
          ref("mail_disabled", 409),
          ref("too_many_requests", 429, "too many deletion mails to this address recently"),
        ]),
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

  // ── the sync surface — every refusal the same not_found, deliberately ──
  const hiddenNotFound = () => ref("not_found", 404, "the same refusal whether the journal is unknown, the token is for a different one, or it is merely trip-scoped");
  paths["/api/v2/{user}/sync/manifest"] = {
    get: {
      summary:
        "Every file this journal's folder holds, with a hash — the up-to-date check for a local " +
        "mirror, and a complete one: the full-resolution originals are included, so a first pull " +
        "is large and a later one carries only what the hashes say changed. This journal's " +
        "position history is in no manifest and behind no route. Owner only.",
      responses: { ...jsonResponse(200, syncManifest, "path, size and hash of every syncable file"), ...refusalResponses([...authRefusals, hiddenNotFound()]) },
    },
  };
  paths["/api/v2/{user}/sync/file/{path}"] = {
    get: {
      summary: "One file's bytes, by the path the manifest named. Read-only, owner only.",
      responses: {
        200: { description: "the file's bytes, with a content-type guessed from its name" },
        ...refusalResponses([...authRefusals, hiddenNotFound()]),
      },
    },
  };

  // ── importing somebody's own data ──────────────────────────────────────
  paths["/api/v2/{user}/import"] = {
    get: {
      summary: "The kinds and formats this door reads, and the ceiling on a request's size. Owner only.",
      responses: { ...jsonResponse(200, importGetDoc, "kinds, formats and the byte ceiling"), ...refusalResponses(ownerRefusals) },
    },
    post: {
      summary:
        "Import a location history (`kind: \"gps\"`, stored as read) or a phone's address book " +
        '(`kind: "contacts"`, read and reported — nothing is written until the agreed rows are ' +
        "sent to POST .../contacts/import). Send ?dryRun to preview. JSON `{kind, format?, inbox|text}`, or multipart with `file`. " +
        'Owner only, with one exception (B2204): a `write:gps` token — minted at ' +
        "POST /api/auth/{user}/gps-token — may call this too, and only this, and only for " +
        '`kind: "gps"` with `dryRun` false or absent; its response has no `extent`. Everything ' +
        "else about this door refuses that token exactly as it refuses any other non-owner call.",
      requestBody: jsonBody(
        z.strictObject({ kind: z.enum(IMPORT_KINDS), format: z.string().optional(), inbox: z.string().optional(), text: z.string().optional() }),
        "name the kind; give the bytes as inbox, text, or (multipart only) file",
      ),
      responses: {
        ...jsonResponse(
          200,
          z.union([gpsImportResult, contactsImportResult]),
          "a gps import, stored (or previewed under ?dryRun) — or a contacts import, read and reported, never written",
        ),
        ...refusalResponses([
          ...ownerRefusals,
          ref("unknown_user", 404),
          ref("invalid_request", 400),
          ref("body_too_large", 413),
          ref("expected_file", 400),
          ref("invalid_body", 400),
          ref("unknown_inbox_file", 404),
          ref("no_file", 400),
          ref("unknown_kind", 400),
          ref("storage_full", 400),
          ref("unreadable", 400),
          ref("contract", 400),
        ]),
      },
    },
  };

  // There is no `delete` here — security review, 2026-09-24. See the route's
  // own doc comment (`app/api/v2/[user]/gps/route.ts`): purging for real is
  // the owner's own act, from the studio's location page, and a bearer door
  // that can never delete anything is not a documented operation.
  paths["/api/v2/{user}/gps"] = {
    get: {
      summary:
        "Which months of raw location history this journal holds — names, never a fix. Owner only.",
      responses: { ...jsonResponse(200, gpsMonthsDoc, "YYYY-MM, sorted"), ...refusalResponses(ownerRefusals) },
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
      requestBody: jsonBody(channelsPatch, "at least one of mail/whatsapp"),
      responses: {
        ...jsonResponse(200, channelsDoc, "the channels as they now stand"),
        ...refusalResponses([...ownerRefusals, ref("invalid_request", 400), ref("capability_unavailable", 409)]),
      },
    },
  };

  paths["/api/v2/{user}/owner/tel"] = {
    get: {
      summary: "The owner's own telephone number — a notification channel, not the address that owns the journal.",
      responses: {
        ...jsonResponse(200, ownerTelDoc, "null fields when there is no number on file"),
        ...refusalResponses(ownerRefusals),
      },
    },
    delete: {
      summary: "Clear the owner's own number — turns their free WhatsApp copy of a day back off.",
      responses: {
        ...jsonResponse(200, ownerTelDoc, "tel: null"),
        ...refusalResponses(ownerRefusals),
      },
    },
  };

  // There is no PATCH on the resource above — setting the number takes two
  // calls, on purpose. A bare PATCH would let an owner token redirect the
  // owner's own WhatsApp copies to a number of its own choosing; proving
  // possession of the number first is what `dayWhatsapp.ts`'s "presence IS
  // the consent" reasoning depends on. See `lib/ownerTel.ts`.
  paths["/api/v2/{user}/owner/tel/verify"] = {
    post: {
      summary: "Start proving a number for the owner's own telephone field — sends a one-time code.",
      requestBody: jsonBody(ownerTelVerifyRequest, 'a telephone number with its country code, e.g. "+41 76 000 00 00"'),
      responses: {
        ...jsonResponse(202, ownerTelVerifyStarted, "an opaque id — bring it, with the code, to `.../verify/redeem`"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("invalid_request", 400),
          ref("capability_unavailable", 409),
          ref("too_many_requests", 429),
          ref("verification_failed", 503),
        ]),
      },
    },
  };

  paths["/api/v2/{user}/owner/tel/verify/redeem"] = {
    post: {
      summary: "Finish proving a number — the code from `.../verify` writes owner.tel, proven, for good.",
      requestBody: jsonBody(ownerTelVerifyRedeem, "the id from `.../verify`, and the code the number received"),
      responses: {
        ...jsonResponse(200, ownerTelDoc, "the number, now proven"),
        ...refusalResponses([...ownerRefusals, ref("invalid_request", 400), ref("invalid_code", 401), ref("too_many_requests", 429)]),
      },
    },
  };

  // There is no direct write here either, and for the same reason —
  // owner.email IS ownership (`lib/api/auth.ts`'s `mayActAsOwner`). Sending
  // a CHANGED owner.email to `PATCH /api/v2/{user}` starts this instead of
  // writing; see that operation's own 202. This door only finishes it.
  paths["/api/v2/{user}/owner/email/redeem"] = {
    post: {
      summary:
        "Finish moving owner.email — the code the new address received writes it, revokes every " +
        "session and agent token the old address held for this journal, and mails the old address.",
      requestBody: jsonBody(ownerEmailRedeem, "the id from the PATCH that started this, and the code the new address received"),
      responses: {
        ...jsonResponse(200, journalDoc, "the journal document, with owner.email now moved"),
        ...refusalResponses([...ownerRefusals, ref("invalid_request", 400), ref("invalid_code", 401), ref("too_many_requests", 429)]),
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
      requestBody: jsonBody(tripCreate, "the whole trip document", TRIP_DECLINABLES),
      responses: {
        ...jsonResponse(201, tripCreatedFirst, "created — carries `next` when this is the journal's first trip"),
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
      requestBody: jsonBody(tripPatch, "only the fields being changed"),
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
        ...refusalResponses([
          ...ownerRefusals,
          ref("gone", 410),
          ref("too_many_requests", 429, "too many deletion mails to this address recently"),
        ]),
      },
    },
  };

  // B2015 — owner-only, same gate as move/split/merge below. The old id
  // keeps answering afterwards: GET/PATCH/DELETE at it come back 308 to the
  // new address, and the reader-facing page tree redirects the same way.
  paths["/api/v2/{user}/trips/{trip}/rename"] = {
    post: {
      summary:
        "Rename a trip's id — the folder, trip.json's own id, every database row a trip_id column " +
        "names, and a redirect record so the old address keeps answering. Never touches gps/.",
      requestBody: jsonBody(tripRenameRequest, "the new id"),
      responses: {
        ...jsonResponse(200, tripRenameResult, "renamed — GET the trip at its new id from here on"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("unknown_trip", 404),
          ref("invalid_trip_id", 400, "not a valid slug, or the same id the trip already has"),
          ref("invalid_request", 400, "the new id is the trip's current one — nothing to rename"),
          ref("trip_id_taken", 409),
        ]),
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
      requestBody: jsonBody(dayWrite, "the whole day document", DAY_DECLINABLES),
      responses: {
        ...jsonResponse(201, dayCreatedFirst, "created — carries `next` when this is the trip's first day"),
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
      summary:
        "Merge-patch a day. Never moves it between draft and published. A draft may stay " +
        "incomplete — completeness is asked at publish; a published day must stay complete (422 incomplete). " +
        "A day that changed while the patch was checked (a publish, another write) answers 409 stale_document.",
      requestBody: jsonBody(dayPatch, "only the fields being changed"),
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

  paths["/api/v2/{user}/trips/{trip}/days/{slug}/media"] = {
    post: {
      summary:
        "Attach already-stored photographs to this day's gallery — never uploads bytes itself " +
        "(POST /api/v2/{user}/media does that first). Retracts a stale declined.media.",
      requestBody: jsonBody(dayMediaAttachRequest, "the srcs an earlier upload already answered with"),
      responses: {
        ...jsonResponse(200, dayDoc, "the day, with the photographs attached"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("unknown_day", 404),
          ref("stale_document", 409),
          ref("invalid_request", 400),
          ref("not_this_trip", 400),
        ]),
      },
    },
    delete: {
      summary:
        "Take photographs off this day's gallery by src — the reversible half; the bytes stay " +
        "on disk (DELETE /api/v2/{user}/media removes those, and detaches from every day too).",
      requestBody: jsonBody(dayMediaDetachRequest, "the srcs to remove, exactly as the day carries them"),
      responses: {
        ...jsonResponse(200, dayDoc, "the day, with the photographs detached"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("unknown_day", 404),
          ref("stale_document", 409),
          ref("invalid_request", 400),
          ref("unknown_media", 404),
        ]),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}/days/{slug}/publish"] = {
    post: {
      summary:
        "Owner only: put a draft day on the site. declineTracked may name only fields the day has " +
        "neither filled in nor already answered; any other name refuses the whole call (400, details.refused).",
      requestBody: jsonBody(publishRequest, "which tracked facts to decline, and whether to send it"),
      responses: {
        ...jsonResponse(200, dayPublished, "published"),
        ...jsonResponse(200, dayPublishPreview, "dryRun — nothing written"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("out_of_scope", 403, "a trip-scoped token cannot publish"),
          ref("unknown_day", 404),
          ref("already_published", 409),
          ref("stale_document", 409, "the day changed while the publish was checked; nothing written"),
          ref("invalid_request", 400, "includes declineTracked naming a field that is not blank (details.refused)"),
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
      requestBody: jsonBody(sendRequest, "which channels to send on"),
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

  // B1903 — move, split and merge, owner-only (a cross-trip move touches
  // two trips at once; see the move route's own doc comment for why this is
  // not trip-scoped like the rest of this parcel).
  paths["/api/v2/{user}/trips/{trip}/days/{slug}/move"] = {
    post: {
      summary: "Move a day to a different date and/or a different trip, keeping its media the same print masters.",
      requestBody: jsonBody(dayMoveRequest, "the destination trip and date"),
      responses: {
        ...jsonResponse(200, dayMoveResult, "moved — GET the returned tripId/slug to see it"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("unknown_trip", 404),
          ref("unknown_day", 404),
          ref("already_exists", 409),
          ref("invalid_date", 400),
          ref("invalid_request", 400),
        ]),
      },
    },
  };
  paths["/api/v2/{user}/trips/{trip}/days/{slug}/split"] = {
    post: {
      summary: "Split one day's update into two, on the same date. The prose is never cut automatically.",
      requestBody: jsonBody(daySplitRequest, "where to cut the photographs, and both halves' own words"),
      responses: {
        ...jsonResponse(200, daySplitResult, "split — GET secondSlug to see the new half, always a draft"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("unknown_trip", 404),
          ref("unknown_day", 404),
          ref("title_required", 409),
          ref("slug_taken", 409),
          ref("invalid_request", 400),
        ]),
      },
    },
  };
  paths["/api/v2/{user}/trips/{trip}/days/{slug}/merge"] = {
    post: {
      summary: "Join two updates on the same trip into one. Refused across trips.",
      requestBody: jsonBody(dayMergeRequest, "the other update's own slug"),
      responses: {
        ...jsonResponse(200, dayMergeResult, "merged — GET the returned slug to see it"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("unknown_trip", 404),
          ref("unknown_day", 404),
          ref("cross_trip", 409),
          ref("invalid_request", 400),
        ]),
      },
    },
  };

  paths["/api/v2/{user}/trips/{trip}/costs/apply"] = {
    post: {
      summary:
        "Write agreed bank-statement rows onto the days they belong to — a row whose date has " +
        "no day yet is filed to the trip's own costs.items instead, never dropped.",
      requestBody: jsonBody(costsApplyRequest, "the rows a person agreed, from GET .../statements/{src}"),
      responses: {
        ...jsonResponse(200, costsApplyResult, "how many rows landed on a day, and which dates were filed to the trip instead"),
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
      requestBody: jsonBody(mediaIntent, "the JSON form's `intent` field — the multipart form carries the same shape as a form field"),
      responses: {
        ...jsonResponse(201, mediaItem, "stored"),
        ...refusalResponses([
          ...authRefusals,
          outOfScope(),
          ref("invalid_request", 400),
          ref("unknown_trip", 404),
          ref("unknown_day", 404),
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

  paths["/api/v2/{user}/trips/{trip}/media/duplicates"] = {
    get: {
      summary: "The same photograph, twice — reports only, never deletes.",
      responses: { ...jsonResponse(200, duplicatesDoc, "groups of look-alike photographs, largest first"), ...refusalResponses(tripWriteRefusals) },
    },
  };

  // ── private zones — B2203 ──────────────────────────────────────────
  paths["/api/v2/{user}/gps/zones"] = {
    get: {
      summary: "The journal's private zones — a home, a place clipped out of every future track.",
      responses: {
        ...jsonResponse(200, gpsZonesDoc, "the zones, the decline flag, the limits, and an ETag — send it back as If-Match on PUT"),
        ...refusalResponses([...ownerRefusals, ref("unreadable_zones", 500)]),
      },
    },
    put: {
      summary:
        "Replace the zone list. Requires If-Match with the ETag GET last answered — refused without one, " +
        "or with a stale one, as stale_document (409). Label a zone exactly \"home\" to arm the recorder's own gate (B2196/B2198).",
      requestBody: jsonBody(gpsZonesWrite, "the whole zone list, and optionally homeDeclined"),
      responses: {
        ...jsonResponse(200, gpsZonesDoc, "the zones, the decline flag, and the limits, as stored, with the new ETag"),
        ...refusalResponses([
          ...ownerRefusals,
          ref("invalid_request", 400),
          ref("stale_document", 409, "no If-Match, or one that does not cover the current ETag — carries the stored document"),
          ref("unreadable_zones", 500),
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
      requestBody: jsonBody(figureDoc, "the whole figure document"),
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

  paths["/api/v2/{user}/trips/{trip}/travellers/from-photo"] = {
    post: {
      summary:
        "Read a party off a group photograph — proposed, never written. Multipart `photo`, or JSON `{inbox}`/`{gallery}`.",
      responses: {
        ...jsonResponse(200, fromPhotoResult, "a proposed party, ordered left to right in the photograph"),
        ...refusalResponses([
          ...tripWriteRefusals,
          ref("helper_unavailable", 404),
          ref("too_many_requests", 429),
          ref("consent_required", 403),
          ref("expected_photo", 400),
          ref("invalid_media", 400),
          ref("invalid_json", 400),
          ref("unknown_inbox_file", 400),
          ref("not_this_trip", 400),
          ref("no_credits", 402),
          ref("model_failed", 502),
        ]),
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
      requestBody: jsonBody(purchaseCreate, "the amount of credits wanted"),
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
  // `/api/v2/{user}/contacts` (list/create), `/contacts/grant`,
  // `/contacts/{id}` (read/patch/delete), `/contacts/{id}/approve`,
  // `/contacts/{id}/revoke` and `/contacts/{id}/resend` are gone — B2295
  // (one door for readers, B2291). Letting somebody in, approving or
  // revoking them happens only from `/<user>/studio/readers`, in the
  // owner's own browser; an agent bearer token reaches neither. `self` and
  // `import` stay: the owner's own contact record, and importing "who was
  // there" from a phone's address book.
  paths["/api/v2/{user}/contacts/import"] = {
    post: {
      summary: "File many pending contacts at once, from rows a person already agreed.",
      requestBody: jsonBody(z.strictObject({ rows: z.array(z.record(z.string(), z.unknown())).min(1) }), "{rows: [{name, email, tel?}, ...]}"),
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
      requestBody: jsonBody(postcardOrderWrite, "the whole order proposal"),
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
  paths["/api/v2/{user}/photobooks/drafts/{trip}"] = {
    get: {
      summary:
        "One trip's photobook arrangement, whole — every option, and the limits each is checked against.",
      responses: {
        ...jsonResponse(200, photobookDraftDoc, "the arrangement as stored"),
        ...refusalResponses([
          ref("photobook_disabled", 404),
          ...ownerRefusals,
          ref("unknown_trip", 404),
          ref("not_found", 404),
        ]),
      },
    },
    put: {
      summary:
        "Arrange a book. Fields sent land on top of what is stored, or on the defaults; the whole arrangement comes back. Charges nothing, builds nothing, prints nothing — the owner opens `url` to price and buy it.",
      requestBody: jsonBody(photobookDraftWrite, "the options to set"),
      responses: {
        ...jsonResponse(200, photobookDraftDoc, "the arrangement, merged and stored"),
        ...jsonResponse(201, photobookDraftDoc, "the first arrangement for this trip"),
        ...refusalResponses([
          ref("photobook_disabled", 404),
          ...ownerRefusals,
          ref("unknown_trip", 404),
          ref("invalid_request", 400),
          ref("stale_document", 409),
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

  // ── the two v1 routes that outlived v1 — B1734, moved in from
  // lib/api/openapi.ts. Neither is a document like the ones every other v2
  // door replaced: one derives a clipped public line from a position history
  // no route may ever return, the other is the second, human-only half of
  // deleting a journal. ───────────────────────────────────────────────────
  paths["/api/v2/{user}/trips/{trip}/track"] = {
    post: {
      summary: "Draw this trip's line from the imported location history — owner only.",
      responses: {
        ...jsonResponse(
          200,
          z.strictObject({
            written: z.boolean(),
            segments: z.number().int().nonnegative(),
            points: z.number().int().nonnegative(),
            zones: z.number().int().nonnegative(),
            trip: z.string(),
            message: z.string(),
            next: z.string().optional(),
          }),
          "segments, points and how many private zones were cut out. `written: false` means " +
            "nothing was stored for these dates, and any existing line was left alone",
        ),
        ...refusalResponses([...tripWriteRefusals]),
      },
    },
  };

  paths["/api/v2/{user}/deletions/{token}"] = {
    post: {
      summary: "Confirm a deletion — the button on the mailed page, never something an agent calls.",
      responses: {
        ...jsonResponse(
          200,
          z.strictObject({
            ok: z.literal(true),
            deleted: z.literal(true),
            kind: z.enum(["journal", "trip"]),
            user: z.string(),
            trip: z.string().optional(),
            title: z.string(),
          }),
          "deleted",
        ),
        ...refusalResponses([
          ref("not_found", 404, "no such token for this journal"),
          ref("gone", 410, "what it pointed at has already gone"),
          ref("deletion_link_used", 409),
          ref("deletion_link_expired", 409),
          ref("too_many_requests", 429),
        ]),
      },
    },
  };

  // ── the sign-in surface — /api/auth/**, moved in from lib/api/openapi.ts
  // (v1) by B1734. This is the only way any client, v2 included, ever gets a
  // token; leaving it out of this document left a caller able to read every
  // write door and no way to obtain the credential they all require.
  // `/api/auth/identity/**` and `/api/auth/logout` stay undocumented — B1734
  // carries forward v1's own exclusion (`OUT_OF_SCOPE_PREFIXES`,
  // test/openapi-contract.test.ts): they set and read a browser cookie, and
  // documenting a cookie route here would invite an agent to call something
  // it cannot authenticate with. ─────────────────────────────────────────
  paths["/api/auth/codes"] = {
    post: {
      summary: "Ask for a one-time code — one door for four credentials.",
      requestBody: jsonBody(
        codesRequest,
        "`for` is which credential the code redeems into: " +
          `${CREDENTIAL_FOR.join(", ")}. "read"/"write" need \`user\`; "identity"/"signup" refuse it. ` +
          '`scope.trip` is only meaningful with `for: "write"`. Always answers 202 whether or not ' +
          "the address owns anything, so this cannot be used to discover which addresses exist — the " +
          'one exception is `for: "write"` to an address that owns nothing and is on no named trip, ' +
          "which answers 403 rather than leaving you waiting for a code that never comes. A new " +
          "request invalidates the previous code. `phone` instead of `email` (B2294) is a guest's " +
          'mobile number, any country: `for: "read"` only, no `channel`, delivered by SMS and only ' +
          "to a sign-in number of a contact the owner added or let in (one the owner typed, or proved by " +
          "an earlier code) — every other number gets the same 202 and no text. At most 3 texts per " +
          "number an hour.",
      ),
      responses: {
        ...jsonResponse(202, codesRequestResponse, "accepted — always, whatever the address"),
        ...refusalResponses([
          ref("invalid_request", 400, "a shape rule, never address-dependent"),
          ref("invalid_email", 400),
          ref("signup_disabled", 404),
          ref("auth_disabled", 404),
          ref("mail_disabled", 503, "nothing issued; any code already held is still live"),
          ref("whatsapp_disabled", 503),
          ref("sms_disabled", 503, "`phone` asked for, and this server sends no SMS"),
          ref("sms_unreachable", 400, "`phone` in a country this server's SMS number cannot reach"),
          ref("mail_failed", 503),
          ref("not_authorised", 403, 'for: "write" to an address that owns nothing and is on no named trip'),
          ref("signup_not_invited", 403),
          ref("too_many_requests", 429, "narrower for write than for read"),
        ]),
      },
    },
  };

  paths["/api/auth/codes/redeem"] = {
    post: {
      summary: "Spend a code — one door for four credentials.",
      requestBody: jsonBody(
        codesRedeemRequest,
        `\`code\` is six digits, ${CODE_TTL_MINUTES} minutes, single use. "read"/"identity" set a ` +
          'cookie and put no token in the body; "write"/"signup" return the token in the body and set ' +
          "no cookie, since the caller is a program with no cookie jar. A wrong code, an expired one, a " +
          'burned one, the wrong `for`, or a `scope.trip` that does not match the code\'s own trip all ' +
          "answer the identical `invalid_code`. A code texted to a `phone` is redeemed with that " +
          '`phone` and `for: "read"`.',
      ),
      responses: {
        ...jsonResponse(200, z.union([codesRedeemCookieResponse, codesRedeemTokenResponse]), 'cookie response for "read"/"identity", token response for "write"/"signup"'),
        ...refusalResponses([
          ref("invalid_request", 400),
          ref("invalid_code", 401, "wrong, expired, burned, or the wrong `for`"),
          ref("signup_disabled", 404),
          ref("auth_disabled", 404),
          ref("signup_not_invited", 403, "the code is not spent"),
          ref("too_many_requests", 429),
        ]),
      },
    },
  };

  paths["/api/auth/links/redeem"] = {
    post: {
      summary: "Spend a one-click sign-in link.",
      requestBody: jsonBody(
        linksRedeemRequest,
        '`for` is "read" or "identity" only — an agent has no browser to follow a link, and a signup ' +
          "link would quietly create a journal on arrival. POST only: a mail scanner follows a link, it " +
          "does not submit a form, and acting on arrival would cost a reader their own sign-in.",
      ),
      responses: {
        ...jsonResponse(200, linksRedeemResponse, "the cookie is set on the response; `next` is where to land"),
        ...refusalResponses([
          ref("invalid_request", 400),
          ref("link_spent", 401, "never followed, already spent, or expired — one answer for all three"),
          ref("not_found", 404, "no such journal, or authentication is off"),
          ref("too_many_requests", 429),
        ]),
      },
    },
  };

  paths["/api/auth/signup/phone"] = {
    post: {
      summary: "Prove a telephone number, step one.",
      requestBody: jsonBody(
        z.strictObject({ tel: z.string().optional(), channel: z.literal("sms").optional() }),
        'The signup token from codes/redeem (for: "signup") rides as `Authorization: Bearer`. Code ' +
          "mode: `tel` needs its own country code — this server stands in no country, so a national " +
          'number is refused rather than guessed. Whatsapp-inbound mode: send no body and poll ' +
          '`links/redeem`\'s sibling instead; a caller with no WhatsApp may send `{"channel": "sms"}` ' +
          "when the answer says `smsFallback: true`.",
      ),
      responses: {
        ...jsonResponse(202, phoneStartResponse, "code mode: an id to redeem against. Inbound mode: a wa.me link and its prefilled text"),
        ...refusalResponses([
          ref("signup_disabled", 404),
          ref("invalid_token", 401, "missing, invalid, or not step two of signup"),
          ref("signup_not_invited", 403),
          ref("sms_disabled", 404),
          ref("invalid_request", 400, "tel missing or not a number with a country code"),
          ref("sms_unreachable", 400, "this server's number cannot reach that number's country"),
          ref("too_many_requests", 429, "3/number/day, 5/address/day, 50/instance/day"),
          ref("verification_failed", 503),
        ]),
      },
    },
  };

  paths["/api/auth/signup/phone/redeem"] = {
    post: {
      summary: "Prove a telephone number, step two.",
      requestBody: jsonBody(
        phoneRedeemRequest,
        "`id` from the request step. Leaving `code` out is the poll for whatsapp-inbound mode: the " +
          'answer is `{"status": "pending"}` until the message arrives, then the success shape; ' +
          '`{"status": "expired"}` means ask the request step again. On success the proven number is ' +
          "attached to the signup token itself — POST /api/v2/journals reads it automatically.",
      ),
      responses: {
        ...jsonResponse(200, phoneRedeemResponse, "proven, or the poll status"),
        ...refusalResponses([
          ref("signup_disabled", 404),
          ref("too_many_requests", 429),
          ref("invalid_token", 401),
          ref("signup_not_invited", 403),
          ref("invalid_request", 400, "no id sent"),
          ref("invalid_code", 401),
        ]),
      },
    },
  };

  paths["/api/auth/handover"] = {
    post: {
      summary: "Spend a handover credential for your own 7-day token.",
      responses: {
        ...jsonResponse(200, handoverExchanged, "a 7-day agent token, and the status URL to read next"),
        ...refusalResponses([
          ref("auth_disabled", 404),
          ref("missing_token", 401),
          ref("invalid_handover", 401, "expired, already used, revoked, or not a handover credential"),
        ]),
      },
    },
  };

  paths["/api/auth/{user}/handover"] = {
    post: {
      summary: "Issue a handover credential the owner can paste into an agent — owner only.",
      responses: {
        ...jsonResponse(200, handoverIssued, `a ${HANDOVER_TTL_MINUTES}-minute credential that can only be exchanged, never used to read or write`),
        ...refusalResponses([
          ref("auth_disabled", 404),
          ref("forbidden", 403, "a trip-scoped bearer, or a caller that is not this journal's owner"),
          ref("no_owner_address", 409),
        ]),
      },
    },
  };

  paths["/api/auth/{user}/gps-token"] = {
    post: {
      summary:
        "Mint the owner's write:gps token — owner cookie only, refuses even the owner's own agent bearer.",
      responses: {
        ...jsonResponse(
          200,
          gpsTokenIssued,
          `a ${GPS_TOKEN_TTL_DAYS}-day token good for POST /api/v2/{user}/import with kind "gps" ` +
            "and dryRun false, and nothing else",
        ),
        ...refusalResponses([
          ref("auth_disabled", 404),
          ref("forbidden", 403, "not signed in as this journal's owner in a browser — a bearer token never counts here"),
          ref("no_owner_address", 409),
        ]),
      },
    },
  };

  paths["/api/auth/{user}/keys"] = {
    get: {
      summary: "The tokens and sessions that can write here — the owner sees every row, anybody else only their own.",
      responses: {
        ...jsonResponse(200, keysList, "one row per live credential this caller may see"),
        ...refusalResponses([ref("forbidden", 403, "no proven address at all"), ref("auth_disabled", 409)]),
      },
    },
    post: {
      summary: "Revoke one of them — the owner may revoke any row, anybody else only their own.",
      requestBody: jsonBody(z.strictObject({ revoke: z.string() }), 'the key id from the GET above: {"revoke": "<key id>"}'),
      responses: {
        ...jsonResponse(200, keyRevoked, "revoked"),
        ...refusalResponses([
          ref("invalid_request", 400, "no key id sent"),
          ref("forbidden", 403, "no proven address at all"),
          ref("unknown_key", 404, "does not exist, or — for a non-owner — belongs to somebody else's address"),
          ref("auth_disabled", 409),
        ]),
      },
    },
  };

  // Declared once per path rather than per operation — 3.1 allows a path-item
  // level `parameters`, every verb on a path has the same holes, and one copy
  // is one thing to be right.
  // Open core: these doors live in paid/. A build without that area answers
  // them with a plain 404, so the document does not offer them.
  const PAID_PATHS: [RegExp, string][] = [
    [/^\/api\/v2\/\{user\}\/(purchases|credits)(\/|$)/, "credits"],
    [/^\/api\/v2\/\{user\}\/postcards\//, "postcards"],
    [/^\/api\/v2\/\{user\}\/photobooks\//, "photobook"],
  ];
  for (const path of Object.keys(paths)) {
    const area = PAID_PATHS.find(([re]) => re.test(path))?.[1];
    if (area && !PAID_AREAS.includes(area)) delete paths[path];
  }

  for (const [path, item] of Object.entries(paths)) {
    const parameters = parametersFor(path);
    if (parameters.length) item.parameters = parameters;
  }

  // Every `/api/v2/**` JSON body goes through `readJson` or `readJsonBody`
  // (`lib/api/jsonBody.ts`, B2243 — `test/json-body-limit.test.ts` holds the
  // routes to it), so every operation that takes one can answer 413. Added
  // here rather than per operation so a new JSON door cannot arrive without
  // it; an operation that already names its own 413 keeps its sentence.
  const tooLarge = refusalResponses([
    ref("body_too_large", 413, `the JSON body is over limits.jsonBodyMaxBytes (${JSON_BODY_MAX_BYTES} bytes) at GET /api/v2/status`),
  ]);
  for (const [path, item] of Object.entries(paths)) {
    if (!/^\/api\/v2\//.test(path)) continue;
    for (const verb of ["post", "put", "patch", "delete"] as const) {
      const op = item[verb];
      if (!op?.requestBody || !("application/json" in op.requestBody.content) || op.responses[413]) continue;
      Object.assign(op.responses, tooLarge);
    }
  }

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
