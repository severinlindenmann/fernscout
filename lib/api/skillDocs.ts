import "server-only";
import { openApiDocumentV2 } from "./v2/openapi";
import { videoToolsKnown } from "../ingest/video";
import {
  IMAGE_FORMATS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  MAX_ITEMS_PER_DAY,
  REQUEST_MAX_BYTES,
  VIDEO_FORMATS,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
} from "../validate/media";
import { getDefaultUsername, listedUsernames } from "../users";
import { SKILL_DOC_SUMMARY, SKILL_DOC_TITLE, type SkillDocSlug } from "./skillDocMeta";

export type { SkillDocSlug };

/**
 * B311, and step 6 of the v2 migration (docs/v2-migration/03-build-order.md).
 *
 * Each of these nine documents used to be a slice cut out of one 140+ KB
 * hand-written guide (`agentGuide()`, retired with this ticket). That guide
 * described `/api/v1`; v2 is a different shape of API — asked-or-declined
 * sections instead of `false`/`"unknown"`, `PUT` to a client-chosen id
 * instead of `POST` to a collection, `If-Match` instead of
 * `idempotency_key` — so a slice of the old prose would have been wrong
 * rather than merely stale.
 *
 * So these are written fresh, against `/api/v2`, and hold themselves to the
 * same rule the old ones did: a field list is *generated* from the frozen
 * Zod schemas (via `/api/v2/openapi.json`'s own JSON Schema, `fieldTable()`
 * below) rather than retyped, so a field renamed in `lib/api/v2/schemas/`
 * cannot go stale here without the generator itself failing first. What is
 * still hand-written is the *why* — the sentence beside each name explaining
 * what it is for, which no schema carries.
 */

function doc(slug: SkillDocSlug, parts: string[]): string {
  const title = SKILL_DOC_TITLE[slug];
  const summary = SKILL_DOC_SUMMARY[slug];
  return `# ${title}\n\n> ${summary}\n\n${parts.join("\n\n")}\n`;
}

// ── generation: field tables straight from the served /api/v2/openapi.json ──

type JsonSchema = {
  required?: string[];
  properties?: Record<string, JsonSchemaField>;
};
type JsonSchemaField = {
  type?: string | string[];
  enum?: string[];
  const?: unknown;
  anyOf?: JsonSchemaField[];
  items?: JsonSchemaField;
};

function typeOf(def: JsonSchemaField): string {
  if (def.enum) return `one of \`${def.enum.join("`, `")}\``;
  if (def.const !== undefined) return `always \`${JSON.stringify(def.const)}\``;
  if (def.anyOf) return def.anyOf.map(typeOf).join(" or ");
  if (def.type === "array") return def.items ? `a list of {${typeOf(def.items)}}` : "a list";
  if (def.type === "object") return "an object — see /api/v2/openapi.json for its shape";
  return typeof def.type === "string" ? def.type : "any";
}

/** The request schema `/api/v2/openapi.json` publishes for one operation —
 * the same JSON Schema a caller validating against the document would read,
 * so this can never name a field the served contract does not. */
function requestSchema(path: string, method: "put" | "post" | "patch"): JsonSchema {
  const openapi = openApiDocumentV2() as unknown as {
    paths: Record<string, Record<string, { requestBody?: { content?: { "application/json"?: { schema?: JsonSchema } } } }>>;
  };
  const schema = openapi.paths[path]?.[method]?.requestBody?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`skillDocs: no request schema at ${method.toUpperCase()} ${path}`);
  return schema;
}

/** A field table generated from the schema, with a hand-written sentence per
 * field for the one thing no schema carries: why it exists. A field present
 * in the schema and missing from `notes` still renders — with no sentence —
 * rather than being silently dropped, so a schema change cannot make this
 * table quietly incomplete. */
function fieldTable(path: string, method: "put" | "post" | "patch", notes: Record<string, string>): string {
  const schema = requestSchema(path, method);
  const required = new Set(schema.required ?? []);
  const rows = Object.entries(schema.properties ?? {}).map(([name, def]) => {
    const req = required.has(name) ? "**required**" : "optional";
    const note = notes[name] ? ` — ${notes[name]}` : "";
    return `| \`${name}\` | ${req} | ${typeOf(def)}${note} |`;
  });
  return ["| Field | | Type |", "| --- | --- | --- |", ...rows].join("\n");
}

function fieldNames(path: string, method: "put" | "post" | "patch"): string {
  const schema = requestSchema(path, method);
  const required = new Set(schema.required ?? []);
  return Object.keys(schema.properties ?? {})
    .map((name) => (required.has(name) ? `\`${name}\` (required)` : `\`${name}\``))
    .join(", ");
}

const example = () => getDefaultUsername() ?? listedUsernames()[0] ?? "your-username";

/** The video row of the accepted-media table — B692, moved from the retired
 * `agentGuide()`. A server with no ffmpeg/ffprobe cannot convert a clip for
 * the browser, and saying so without a ceiling number stops an agent reading
 * "at most 500 MB" as "this will work if I keep it small". */
function videoRow(): string {
  if (videoToolsKnown() === false) {
    return (
      "**not accepted on this instance.** ffmpeg and ffprobe are not installed, so a clip " +
      "cannot be converted for the browser. Send photographs instead, and tell whoever runs " +
      "this instance if clips matter to you — it is one package away."
    );
  }
  return (
    `${VIDEO_FORMATS.join(", ")} — at most ${(VIDEO_MAX_BYTES / 1024 / 1024).toFixed(0)} MB and ` +
    `${VIDEO_MAX_SECONDS}s`
  );
}

// ── the nine documents ──────────────────────────────────────────────────

function newAccount(): string {
  const user = example();
  return doc("new-account", [
    "## Getting a code",
    "Two calls, whatever you are asking for — a fresh journal, or write access to one that " +
      "already exists:",
    "```http\nPOST /api/auth/codes\nContent-Type: application/json\n\n" +
      '{"email": "them@example.com", "for": "signup"}\n```',
    "`for` is one of `signup` (a new journal), `write` (an agent token on a journal that " +
      "exists — send `user` too), `read` (a guest cookie, browser-only) or `identity` (proves " +
      "an address, authorises nothing). The answer is always `202 {\"status\": \"accepted\"}` " +
      "whatever the address — a mail either lands or it does not, and the response cannot say " +
      "which without letting a caller enumerate addresses. One exception, and it is about the " +
      "instance rather than the address: an invite-only instance answers `403 " +
      "signup_not_invited` to `for: \"signup\"` from an address its operator has not named, " +
      "because leaving somebody waiting for a mail that is never coming is worse than saying " +
      "so.",
    "```http\nPOST /api/auth/codes/redeem\nContent-Type: application/json\n\n" +
      '{"email": "them@example.com", "code": "123456", "for": "signup"}\n```',
    "`for: \"write\"`/`\"signup\"` answer with the token itself, in the body — never a cookie, " +
      "since an agent has no cookie jar. `for: \"write\"` on somebody already on one trip " +
      'takes `"scope": {"trip": "<trip-id>"}` at the code request and answers a token scoped ' +
      "to that trip alone; leaving it out is the journal's own owner asking for the whole " +
      "journal.",
    "**A signup token creates exactly one journal, and is spent by doing so:**",
    "```http\nPOST /api/v2/journals\nContent-Type: application/json\nAuthorization: Bearer fs_signup_…\n\n" +
      fieldTable("/api/v2/journals", "post", {
        username: "permanent — never invent or illustrate one, ask",
        title: "what the journal is called",
        ownerName: "their real name",
        ownerNickname: "what the site should call them — never derived from `ownerName`",
        visibility: '`public` or `guest` — no default, ask which',
        defaultLocale: "the owner's own language — sets the welcome mail's",
        locales: "which languages a reader may switch into; must include `defaultLocale`",
        baseCurrency: "**permanent** — every cost in the journal is added up in it",
      }) +
      "\n```",
    "The reply carries the journal's own agent token — no second code — plus a one-time " +
      "sign-in link for the person, never for you.",
    "## If you were handed a key instead",
    "An owner can copy a handover credential out of their own journal's access page: twenty " +
      "minutes, single use, spent for a seven-day token of your own.",
    "```http\nPOST /api/auth/{user}/handover   (owner's cookie, mints the credential)\n" +
      "POST /api/auth/handover                (you spend it)\nAuthorization: Bearer fs_handover_…\n```",
    "## First, get your bearings",
    "Before anything else, two free reads:",
    "```http\nGET /api/v2/status              — this instance: capabilities, limits, pricing. No auth.\n" +
      "GET /api/v2/{user}/status       — this journal and this token: drafts waiting, trips " +
      "you may write to, storage, inbox counts, and whether your token is journal-wide or " +
      "scoped to one trip.\n```",
    "A `401` on the second one means go and get a code. A `200` is your bearings in one call " +
      "— read it before writing anything.",
    `The full contract is generated from the schemas at /api/v2/openapi.json. The rest of ` +
      "this journal's guide is indexed at /documentation.txt.",
  ]);
}

function addJournal(): string {
  return doc("add-journal", [
    "## Reading and correcting a journal",
    "```http\nGET /api/v2/{user}\n```",
    "Answers the journal document with an `ETag`. `PATCH` merges — send only what changes " +
      "— and a concurrent edit is caught with `If-Match: <etag you read>`; without it the " +
      "write still lands, since nothing else is likely to be editing a journal's own settings " +
      "at once.",
    "```http\nPATCH /api/v2/{user}\nContent-Type: application/json\nAuthorization: Bearer fs_agent_…\n\n" +
      fieldTable("/api/v2/{user}", "patch", {
        title: "what the journal is called",
        owner: "`{name, nickname, email}` — `email` decides who can get a token, and is refused here",
        locales: "which UI languages this journal offers; the first is the default",
        baseCurrency: "**permanent, refused on a PATCH** — every cost is already added up in it",
        displayCurrencies: "must include `baseCurrency`",
        units: '`"metric"` or `"imperial"`',
        visibility: '`public` or `guest` — whether this instance advertises the journal at all',
        tagline: "the line under the title on the landing page, or decline it",
        figures: 'the journal\'s default walking figures — `{"mode":"off"}` or `{"mode":"set","figures":[ids]}` pointing into `/figures`, or decline it',
        declined: "which of `tagline`/`figures` were consciously left out, and why (10+ characters)",
      }) +
      "\n```",
    "**`owner.email` is refused on every write.** It is the address that decides who can get a " +
      "token for this journal, so a token cannot move it.",
    "**A journal's `features` are not a field here at all.** Whether mail, auth, contacts, " +
      "postcards and so on are configured is the operator's own fact, read from " +
      "`GET /api/v2/status`'s `capabilities` block — a journal cannot switch one on or off, " +
      "and there is nothing to send.",
    "## Deleting a journal",
    "```http\nDELETE /api/v2/{user}\nAuthorization: Bearer fs_agent_…\n```",
    "Answers `202`, and **deletes nothing**. The server mails the address that owns the " +
      "journal a single-use confirmation link; only the button on that page deletes. Report " +
      "this as a mail waiting, never as done, and never offer to follow the link yourself — " +
      "you cannot finish this on the owner's behalf, on purpose.",
    "Owner only, both calls. A trip-scoped token gets `403 forbidden`.",
  ]);
}

function addATrip(): string {
  return doc("add-a-trip", [
    "## Creating a trip",
    "A trip's id is client-chosen and permanent — you `PUT` it into existence rather than " +
      "`POST` to a collection:",
    "```http\nPUT /api/v2/{user}/trips/{trip}\nContent-Type: application/json\nAuthorization: Bearer fs_agent_…\n\n" +
      fieldTable("/api/v2/{user}/trips/{trip}", "put", {
        id: "must match the URL's `{trip}` — lowercase words joined by hyphens, permanent",
        title: "what the trip is called",
        dates: "`{from, to}`, both `YYYY-MM-DD` — required, never guessed",
        visibility: '`private`, `public` or `guest` — an explicit choice, never a guessed default',
        people: "who was on it — `[{name, email, nickname?}]`, 1 to ten. Write access **and** the byline",
        teaser: "required on a closed trip only: may its existence show as a locked card nobody may open?",
        rates: '`{currencies: ["JPY"], manual?: {"JPY": 148.2}}` — manual rates are units per 1 EUR — or decline it',
        costs: "a budget and preparation spend, or decline it (see /skill/costs.md)",
        plan: "an upcoming trip's intended route, or decline it",
        days: "a trip's days — leave empty and write each day through its own door instead",
        translations: "the trip's title/tagline/intro in the journal's other languages, or decline it",
        accent: "the trip's colour, or decline it",
        figures: 'how the party is drawn: `{"mode":"off"}`, `{"mode":"journal"}` or `{"mode":"custom","figures":[ids]}`, or decline it',
        tagline: "one line under the title, or decline it",
        intro: "the trip page's opening prose, or decline it",
        listed: "public trips only: is it advertised (sitemap, feed, switcher)?",
        declined: "which asked-or-declined sections were consciously left out, and why (10+ characters)",
        test: "`true` only for content nobody lived",
      }) +
      "\n```",
    "## Every section is asked, or declined — never silently missing",
    "A trip is not a form with defaults: `rates`, `costs`, `plan`, `days`, `translations`, " +
      "`accent`, `figures`, `tagline` and `intro` are each either sent, or named in `declined` " +
      "with a real reason (ten characters or more — `\"n/a\"` does not satisfy it). Sending " +
      "neither is refused with `422 incomplete`, naming exactly which sections are missing and " +
      "what to send for each. **Never invent a value to get past this** — decline it, or go " +
      "and ask.",
    "**Buddies are their own question.** A trip with only the owner in `people` must decline " +
      "`buddies` (e.g. `\"travelling solo\"`); a trip with more than one person in `people` must " +
      "not decline it. Everyone added is mailed — either \"you are on trip X\" if this journal " +
      "already knows their address, or an onboarding invite if it does not — and the echo's " +
      "`notifications` says which went out. **That mail is not access**: it materialises only " +
      "once that person proves the address through their own sign-in code.",
    "**`teaser` and `listed` are conditional on `visibility`.** A closed trip (`private`/`guest`) " +
      "must answer `teaser` and must not send `listed`; a `public` trip must answer `listed` " +
      "(declinable) and must not send `teaser`. Sending the wrong one for the trip's own " +
      "visibility is refused.",
    "**`cover` is not a field at create.** No photograph can exist yet, so the question has no " +
      "honest answer here — it becomes writable once the trip holds media, via `PATCH`.",
    "## Reading, correcting, deleting",
    "```http\nGET    /api/v2/{user}/trips              — every trip, paged\n" +
      "GET    /api/v2/{user}/trips/{trip}       — one trip, with its days inline\n" +
      "PATCH  /api/v2/{user}/trips/{trip}       — merge-patch; nothing is asked, but supplying " +
      "a previously declined section clears the decline\nDELETE /api/v2/{user}/trips/{trip}       " +
      "— owner only. Answers 202 and deletes nothing: a mail goes to the owner, and only its " +
      "button deletes\n```",
    "`PATCH` refuses `days` outright — a day changes through its own route " +
      "(`/skill/add-a-day.md`), never as a side effect of shortening a list here. Concurrent " +
      "edits use `If-Match: <etag>` from the last `GET`; a stale or missing one on a create " +
      "retry answers `409 stale_document` carrying the document as it actually stands.",
    "## Drawing the party",
    "A figure is a reusable entry in the journal's own library, not something typed inline on " +
      "a trip:",
    "```http\nGET  /api/v2/{user}/figures/presets           — the whole vocabulary, and starting points\n" +
      "GET  /api/v2/{user}/figures/preview?figure={…}  — draw one figure as an SVG before it is written\n" +
      "PUT  /api/v2/{user}/figures/{id}                — create or replace a figure at a client-chosen id\n```",
    "Ask how somebody wants to be drawn — never infer it from a name, a country or a " +
      "photograph — and show them the preview before it is written. A trip then names which " +
      "figures walk it (`figures.mode`); it never repeats their description.",
  ]);
}

function addADay(): string {
  const path = "/api/v2/{user}/trips/{trip}/days/{slug}";
  return doc("add-a-day", [
    "## Writing a day",
    "A day's slug is client-chosen — `YYYY-MM-DD-slug` — and you `PUT` it into existence:",
    "```http\nPUT " + path + "\nContent-Type: application/json\nAuthorization: Bearer fs_agent_…\n```",
    "**Every field a day may carry:** " + fieldNames(path, "put") +
      ". `title`, `date` and `content` are always required. Full descriptions — what " +
      "`travelScene` plays, what `weather` accepts — are at `/api/v2/openapi.json` under this " +
      "path's `PUT` request.",
    "**Everything else is asked, or declined.** `media`, `costs`, `coordinates`, `weather`, " +
      "`time`, `timezone`, `location`, `country`, `countryCode`, `transportMode`, `tags`, " +
      "`translations` (only where the journal keeps more than one language) and `visibility` " +
      "are each either sent, or named in `declined` with a real reason — v1's per-field " +
      "true/false/unrecorded encoding is retired; write " +
      "`declined: {\"costs\": \"nothing was spent this day\"}` " +
      "instead. Never invent a value to satisfy this, and never reach for a decline just to " +
      "get past a refusal — ask.",
    "**Weather has exactly two honest routes.** `weather: true` asks this server to look the " +
      "day's weather up itself, from its own `coordinates` and `date` — never guess one. " +
      "The lookup happens inside this write, so the day it answers with already carries the " +
      "reading. A public archive lags real time, so a day written the evening it happened " +
      "can come back with `weather` still `true` and no reading: that is \"not yet\", not a " +
      "failure, and nothing on this server comes back for it — send `weather: true` again " +
      "later and it asks the archive again. A reading already on the day is never overwritten " +
      "by asking. " +
      "`weatherData` is a reading somebody actually took: it must name a `source` and a " +
      "`recordedAt`, and `open-meteo` is refused as a source because that name means the " +
      "server looked it up.",
    "**It always arrives as a draft.** `status` accepts only `\"draft\"` — publishing is a " +
      "separate call, below, and it is never a side effect of writing or correcting a day.",
    "```json\n{\"title\": \"Lanterns of Hoi An\", \"date\": \"2026-08-26\", \"lat\": ..., " +
      "\"content\": \"…\", \"declined\": {\"costs\": \"cash, nobody kept the receipts\"}}\n```",
    "## Correcting a day",
    "```http\nPATCH " + path + "\n```",
    "A merge-patch: send only what changed. Nothing is required — attaching one photograph " +
      "must not re-open every question — but a field cannot be both sent and declined in the " +
      "same patch, and sending a field that was previously declined clears that decline. " +
      "`status` is never accepted here: a draft you correct stays a draft, and a published day " +
      "you correct stays published and visible to whoever already read it.",
    "## Publishing, when they say so",
    "```http\nPOST " + path + "/publish\nContent-Type: application/json\nAuthorization: Bearer fs_agent_…\n\n" +
      '{"sendMail": true}\n```',
    "Owner only — a trip-scoped token writes days and cannot put them on the site. " +
      "`declineTracked` lets a publish decline a trip-tracked fact the day genuinely has none " +
      "of; `sendMail`/`sendWhatsapp` each default to absent, since publishing fifteen days " +
      "must never default to fifteen letters. Ask before setting either to `true`. A `402` " +
      "means the balance cannot cover the send — the day stays a draft and nothing is sent; " +
      "hand over a `PUT /api/v2/{user}/purchases/{id}` link rather than retrying.",
    "`POST " + path + "/unpublish` takes it back off the site — reversible, nothing deleted. " +
      "`POST " + path + "/send` sends (or resends) a published day on named `channels` " +
      "(`[\"mail\"]`, `[\"whatsapp\"]`, or both) — never idempotent, so ask again in words " +
      "before calling it twice.",
    "## Deleting",
    "```http\nDELETE " + path + "\n```",
    "A **draft** day deletes outright — no confirmation, since it was never on the site; its " +
      "media is kept. A **published** day cannot be deleted through this door at all — " +
      "`409 published_day_not_deletable` — `unpublish` first.",
  ]);
}

function ingestPhotos(): string {
  const path = "/api/v2/{user}/media";
  return doc("ingest-photos", [
    "## One door for every kind of bytes",
    "```http\nPOST " + path + "\nContent-Type: multipart/form-data\nAuthorization: Bearer fs_agent_…\n\n" +
      "file=@DSC_4471.HEIC\nintent={\"kind\": \"photo\", \"trip\": \"japan-2027\", \"day\": \"lanterns-of-hoi-an\", \"caption\": \"…\"}\n```",
    "One photograph (or clip, or document, or export) per call. `intent.kind` is one of " +
      `\`${["photo", "bank_export", "gps_history", "document"].join("`, `")}\`, and it decides ` +
      "which questions the intent is asked — a bank statement has no caption, a photograph is " +
      "asked for `day`. Each asked question is answered or declined, the same rule as a day's " +
      "own sections: `declined: {\"day\": \"no day written yet — stage it for later\"}`.",
    "**No trip named at all lands in the journal-wide inbox** (owner only) rather than any one " +
      "trip's gallery — that is the door for a card of two hundred photographs with no days " +
      "written yet.",
    "```http\nGET    /api/v2/{user}/inbox      — everything staged, by shelf (media / files)\nDELETE " +
      "/api/v2/{user}/inbox/{id} — discard one; no confirmation, since nothing here has ever " +
      "been on the site\n```",
    "To attach a staged file to a trip and day later, send the same POST again with " +
      '`{"intent": {...}, "inbox": "<id>"}` instead of bytes — it moves the file rather than ' +
      "copying it.",
    "Or hand over URLs instead of bytes: `{\"intent\": {...}, \"url\": \"https://…\"}` — https " +
      "and public hosts only; anything resolving to a private, loopback or link-local address " +
      "is refused, including after a redirect.",
    "**Nothing here reads a photograph's EXIF.** A picture carrying GPS and a timestamp adds no " +
      "`lat`, `lng` or `time` to the day — send those yourself through the day's own `PUT`/`PATCH`.",
    "## What is accepted",
    "| | |\n| --- | --- |\n" +
      `| images | ${IMAGE_FORMATS.join(", ")} — at most ${(IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB, ${IMAGE_MAX_EDGE}px on the longest edge |\n` +
      `| video | ${videoRow()} |\n` +
      `| per day | at most ${MAX_ITEMS_PER_DAY} items |\n` +
      `| per request | at most ${(REQUEST_MAX_BYTES / 1024 / 1024).toFixed(0)} MB of body |`,
    "**Send the largest file you have.** The site serves a resized copy; the original is kept " +
      "whole as the print master, and there is no way to add resolution back later.",
    "```http\nGET    " + path + "?trip=japan-2027   — one trip's stored media, paged\nDELETE " + path +
      '\n{"src": "…"}                              — remove a stored item by the src an upload answered with\n```',
    "## A folder of photographs, all at once",
    "For a whole memory card, on the machine the journal lives on, `npm run ingest` is the " +
      "faster route — it reads each file's own timestamp and place, groups them into days, and " +
      "writes drafts around the result. Over the network you have only the door above, which is " +
      "fine for a handful of pictures: send them and they land, one call per file.",
  ]);
}

function inviteSomeone(): string {
  return doc("invite-someone", [
    "## Two links, and only one is safe to forward",
    "Only the journal's owner may issue either — never a trip-scoped token:",
    "```http\nPUT /api/v2/{user}/invites/{id}\nContent-Type: application/json\nAuthorization: Bearer fs_agent_…\n\n" +
      fieldTable("/api/v2/{user}/invites/{id}", "put", {
        id: "client-chosen, permanent — an invite has no update once created",
        kind: '`"guest"` (journal-wide reading) or `"buddy"` (write access to one trip)',
        trip: "required for `buddy`, refused for `guest` — a guest link is never trip-scoped",
        email: "the owner vouching for an address — mails it and pre-approves it on arrival",
        name: "a label for the owner's own list",
        locale: "the language the invite mail is sent in",
        expiresAt: "absent means 30 days — never send a link with no expiry",
      }) +
      "\n```",
    "| | `guest` | `buddy` |\n| --- | --- | --- |\n" +
      "| Landing URL | `/<user>/invite/guest/<token>` | `/<user>/invite/buddy/<token>` |\n" +
      "| Leads to | reading the journal | **writing to one trip** |\n" +
      "| Scope | the whole journal | one named trip |\n",
    "**Say out loud which one you are handing over.** A guest link belongs in a family group " +
      "chat; a buddy link grants write access once approved and does not. **Neither grants " +
      "anything by itself** — whoever opens one proves their own address and lands in the " +
      "owner's approval queue. Report a link as an invitation to *ask*, never as \"they now have " +
      "access\".",
    "`GET /api/v2/{user}/invites` lists what has been issued (no tokens); " +
      "`GET .../invites/{id}` reads one; `DELETE .../invites/{id}` revokes it — everybody " +
      "already approved through it stays in.",
    "## The approval queue",
    "```http\nGET  /api/v2/{user}/contacts               — the queue, paged\nPOST /api/v2/{user}/contacts/{id}/approve  " +
      "— grant access. The only call in the codebase that does\nPOST /api/v2/{user}/contacts/{id}/revoke   — end it. Reversible by approving again\nPOST " +
      "/api/v2/{user}/contacts/{id}/resend   — re-mail a pending contact's link\n```",
    "**A contact's address never reads back.** `GET .../contacts` and `GET .../contacts/{id}` " +
      "answer with a name, a locale, a status and `hasPostalAddress` (a bare boolean) — never " +
      "the email or a street address, even though `POST .../contacts` and `PATCH .../contacts/{id}` " +
      "accept `email` on the way in, because it is how the owner names who to mail. You can " +
      "propose a contact; you can never read one's address back.",
    "## Channels",
    "```http\nGET   /api/v2/{user}/channels\nPATCH /api/v2/{user}/channels\n{\"mail\": true, \"whatsapp\": false}\n```",
    "Mute switches for the owner's own sending channels — `null` for a channel this instance " +
      "does not offer at all, so a switch that cannot exist never reads back as a confident " +
      "`false`.",
  ]);
}

function costs(): string {
  return doc("costs", [
    "## A trip's budget, spend and rates all live on the trip document",
    "There is no separate costs endpoint in v2 — `costs`, and the currencies a trip's money " +
      "moves in, are sections of the trip itself (see /skill/add-a-trip.md):",
    "```http\nPATCH /api/v2/{user}/trips/{trip}\nContent-Type: application/json\nAuthorization: Bearer fs_agent_…\n\n" +
      "{\"costs\": {\"budget\": {\"total\": 12000, \"days\": 45, \"currency\": \"CHF\"}, " +
      "\"items\": [{\"label\": \"Rail pass\", \"amount\": 420, \"category\": \"preparation\"}], " +
      "\"note\": \"The rail pass is the decision everything else follows from.\"}}\n```",
    "`budget.total` and, optionally, `budget.days` and `budget.currency` (absent means the " +
      "journal's base currency); `items` are preparation costs — money spent *before* leaving " +
      "— in the same shape as a day's own `costs` lines; `note` is `costs.md`'s old prose body. " +
      "What was spent *on* the trip belongs on its days, not here — see /skill/add-a-day.md.",
    "`rates.currencies` is the list of currencies this trip's figures may name; " +
      "`rates.manual` supplies or overrides a rate the server's own reference table (ECB) does " +
      "not carry. **The convention is units per 1 EUR** — `{\"VND\": 30500}` — which is a " +
      "different convention from v1's \"per 1 unit of the journal's base currency\"; read the " +
      "trip back and check the number rather than assuming the old shape.",
    "Either section may be declined instead — `declined: {\"costs\": \"we didn't track spending " +
      "on this trip\"}` — and a trip that says nothing about either is refused with " +
      "`422 incomplete`.",
    "## What the trip actually cost, from a bank statement",
    "```http\nPOST /api/v2/{user}/media\n{\"intent\": {\"kind\": \"bank_export\", \"trip\": \"japan-2027\"}, …}\n" +
      "GET  /api/v2/{user}/statements/{src}\n```",
    "Staging a statement through the media door answers with its `src`; " +
      "`GET .../statements/{src}` reads it as a report — merchants, payments and the rate each " +
      "foreign currency actually cost, taken from the money the bank moved. **It writes " +
      "nothing.** Agree the categories with the person, merchant by merchant — a statement says " +
      "what was paid, never what it was for, and `other` is a real answer.",
    "```http\nPOST /api/v2/{user}/trips/{trip}/costs/apply\nContent-Type: application/json\n\n" +
      "{\"rows\": [{\"date\": \"2026-06-22\", \"label\": \"Padaria Central\", \"amount\": 11.65, " +
      "\"currency\": \"CHF\", \"category\": \"food\"}]}\n```",
    "Writes the agreed rows onto the days they belong to. A date whose day nobody has written " +
      "yet is refused rather than silently attached to a neighbour.",
  ]);
}

function sendPostcards(): string {
  return doc("send-postcards", [
    "## Proposing a printed postcard",
    "A journal with `postcards` and `contacts` switched on (check `GET /api/v2/status`'s " +
      "`capabilities`) can put a real card in somebody's letterbox. **You compose it; you " +
      "never send it.**",
    "```http\nGET /api/v2/{user}/postcards/recipients\n```",
    "Answers with a name, a town, a country — **never a street** — for everybody on this " +
      "journal's contacts list who has asked for a real postcard. A card is addressed by " +
      "`contactId`, never by an address you were told in a conversation.",
    "```http\nPUT /api/v2/{user}/postcards/orders/{id}\nContent-Type: application/json\nAuthorization: Bearer fs_agent_…\n\n" +
      fieldTable("/api/v2/{user}/postcards/orders/{id}", "put", {
        source: '`{trip, day, photo}` for a photograph already on a trip, or `{inbox: "<id>"}` for a staged one',
        message: "the card's own words — the author's, never invented",
        from: "who it is signed as",
        recipients: "contact ids — 1 to 25",
        locale: "the language the message is written in; absent means the journal's default",
      }) +
      "\n```",
    "**This charges nothing and prints nothing.** It writes a proposal and answers with a " +
      "`url` on the response document. The owner opens that page, sees the card laid out, its " +
      "cost and their balance, and presses one button — the only thing in this system that " +
      "puts a card in the post. Hand over the URL and say a preview is waiting; do not say the " +
      "cards have been sent.",
    "`GET /api/v2/{user}/postcards/orders/{id}` reads its status back later. " +
      "`GET /api/v2/{user}/postcards/texts?trip=…` offers each day's opening line, per " +
      "language, as prefill material for the message — nothing here writes or translates it " +
      "for you.",
  ]);
}

function makeAPhotobook(): string {
  return doc("make-a-photobook", [
    "## There is nothing here for you to propose",
    "Choosing the book, pricing it, paying for it and sending it to the printer is one page " +
      "and one press — owner-only, in the browser, outside `/api/v2` entirely. Point the owner " +
      "at their own trip's photobook page rather than looking for a build or a propose call, " +
      "because there is not one.",
    "Once a book has been ordered, this is the one thing you can do:",
    "```http\nGET /api/v2/{user}/photobooks/orders/{id}\nAuthorization: Bearer fs_agent_…\n```",
    "Reads its size, cover, cost, and — once it has gone to the printer — who it went to, by " +
      "`contactId` and never a street address. Say what this call reports; do not say a book " +
      "has been printed or is on its way because you asked for one, only when this call says so.",
  ]);
}

/** The document itself, generated fresh so it reflects this server and this journal example. */
export function skillDoc(slug: SkillDocSlug): string {
  switch (slug) {
    case "new-account":
      return newAccount();
    case "add-journal":
      return addJournal();
    case "add-a-trip":
      return addATrip();
    case "add-a-day":
      return addADay();
    case "ingest-photos":
      return ingestPhotos();
    case "invite-someone":
      return inviteSomeone();
    case "costs":
      return costs();
    case "send-postcards":
      return sendPostcards();
    case "make-a-photobook":
      return makeAPhotobook();
  }
}
