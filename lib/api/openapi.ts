import "server-only";
import { serverSite } from "@/lib/site";
import { getDefaultUsername, listedUsernames } from "@/lib/users";
// Shared with the /skill/*.md guides and /documentation.txt. A machine
// contract that disagrees with the prose about what `private` means is worse
// than either.
import {
  LOCALE_LIST,
  PRIVATE_SHUTS_OUT_GUESTS,
  SECOND_LANGUAGE_COMMITMENT,
  VISIBILITY_ENUM_NOTE,
  VISIBILITY_MEANING,
  VISIBILITY_NOT_A_LOCK,
} from "@/lib/api/agentCopy";
import { EDITABLE_DAY_FIELDS } from "@/lib/api/entries";
import { RESERVED_SOURCES } from "@/lib/weather";
import { CODE_TTL_MINUTES } from "@/lib/auth";

/** Markdown emphasis is prose's, not a JSON `description`'s — the same trim
 * `VISIBILITY_NOT_A_LOCK` gets a few lines down, done once. */
const plain = (text: string) => text.replace(/[`*]/g, "");
import {
  CREDIT_STEP,
  EXTRA_STORAGE_BYTES,
  EXTRA_STORAGE_CREDITS,
  MAX_CREDITS,
  MIN_CREDITS,
} from "@/lib/credits/pricing";
import { INBOX_FILE_EXTENSIONS, INBOX_KINDS } from "@/lib/inbox";
import { IMPORT_KINDS } from "@/lib/gps/api";
import { GPS_FORMATS } from "@/importers/gps";
import { COSTS_FORMATS } from "@/importers/costs";
import { CONTACTS_FORMATS } from "@/importers/contacts";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
// Every enum below is imported rather than typed out. A hand-written list
// beside a validator's own list is two lists, and the day they disagree the
// document is telling an agent to send something the server refuses — which
// is worse than saying nothing, because it is confidently wrong. B540, and
// `test/openapi-contract.test.ts` fails when one of these drifts.
import { TRANSPORT_MODES, TRAVEL_SCENE_VARIANTS } from "@/lib/validate/entry";
import { PHOTO_VISIBILITIES } from "@/lib/photos";
import { COST_CATEGORIES } from "@/lib/costFormat";
import { FEATURE_NAMES } from "@/lib/config";
import { TRACKS } from "@/lib/tracks";
import { ACCENTS, COSTS_VISIBILITIES, FIGURE_FIELDS, STATUSES, VISIBILITIES } from "@/lib/tripWrite";
import { BOOK_SIZES, COVER_TYPES } from "@/lib/photobook/spec";
import {
  CAPTION_MAX_CHARS,
  IMAGE_FORMATS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  MAX_ITEMS_PER_DAY,
  REQUEST_MAX_BYTES,
  VIDEO_FORMATS,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_SHORT_SECONDS,
} from "@/lib/validate/media";

/**
 * The machine contract for the same API the `/skill/*.md` guides describe in
 * prose.
 *
 * `/documentation.txt` has always linked here; until now the link was a 404,
 * which is the worst failure a discovery document can have — an agent follows
 * it, gets nothing, and has no way to tell whether the API exists.
 *
 * Written out beside the routes rather than generated from a decorator
 * library: a hand-written document that is checked by a test is more honest
 * than a generated one nobody reads. It used to say "there are five
 * endpoints" — it describes over thirty, and had for a long time.
 *
 * **Every route an agent can reach with a bearer token belongs here.** That is
 * `/api/v1/**` and `/api/auth/**`, and `test/openapi-contract.test.ts` fails
 * when one of them is missing. The browser-only flows — contacts, push,
 * reactions, address lookup — are deliberately out of scope and named in that
 * test's allowlist, because documenting a cookie route in the machine contract
 * invites an agent to call something it cannot authenticate.
 *
 * Shared between `/openapi.json` (the machine contract) and `/docs/api` (the
 * same document, rendered for a person) so the two cannot drift into
 * describing two different APIs.
 */
/**
 * The trip visibilities, most open first.
 *
 * B302: that is the order a person decides in, and it is deliberately not the
 * order `VISIBILITIES` declares them in. The ordering is written here and the
 * *membership* comes from the validator's own list, so a value added there and
 * forgotten here fails `test/openapi-contract.test.ts` rather than quietly
 * becoming a value the document does not offer.
 */
const VISIBILITY_ENUM = ["public", "guest", "private"].filter((value) =>
  (VISIBILITIES as readonly string[]).includes(value),
);

export function openApiDocument() {
  const site = serverSite();
  // `listedUsernames()`, not `getUsernames()`: this document is public, and the
  // worked example would otherwise name whichever journal directory sorts
  // first — including one whose config asked not to be advertised. The same
  // line in lib/api/documentation.ts:455 does it this way; this one did not.
  // B473.
  const example = getDefaultUsername() ?? listedUsernames()[0] ?? "username";

  /**
   * Every refusal answers with this, and `error` is a word from a published
   * vocabulary rather than free text.
   *
   * 139 of the 149 places this API returns a code returned one the document
   * had never mentioned. For a reader with the source that is fine; for the
   * only reader this API has it is a word to guess at, and B540 watched one
   * guess. The enum below is the whole vocabulary and each entry says what to
   * do next, not only what happened.
   */
  const errorSchema = {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "string",
        enum: Object.keys(ERROR_CODES),
        description: Object.entries(ERROR_CODES)
          .map(([code, meaning]) => `- \`${code}\` — ${meaning}`)
          .join("\n"),
      },
      message: {
        type: "string",
        description: "A sentence, where the code alone is not enough to act on.",
      },
      problems: {
        type: "array",
        description:
          "Every problem at once, not the first — an agent fixing its own body needs the " +
          "whole list in one round trip. Each names the field, what arrived and what was " +
          "expected, and carries a `hint` where the triple is not enough.",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            got: { type: "string" },
            expected: { type: "string" },
            hint: { type: "string" },
          },
        },
      },
    },
  };

  const document = {
    openapi: "3.1.0",
    info: {
      title: `${site.name} API`,
      version: "1",
      summary: "Read and write a travel journal.",
      description:
        "The agent is the editor here: it writes, it publishes, it corrects. " +
        "Everything created arrives as a draft first, so the person can read it " +
        "back; putting it on the site is a second call, POST .../days/{slug}/publish, " +
        "and that call is not how you edit a day — PATCH the same URL as the day " +
        "itself for that. " +
        "Nothing that spends this instance's own model or transcription budget " +
        "is here — drafting prose, captioning photos, transcribing audio and " +
        "conversation search stay inside the helper at /agent and the WhatsApp " +
        "channel, because a v1 door onto them would sell the operator's own " +
        "Anthropic/Deepgram key in credits you did not buy for that purpose; " +
        "bring your own model and hand this API the finished content. " +
        `The prose guides are at ${site.url}/skill/*.md, indexed from ${site.url}/documentation.txt.`,
      // No SPDX identifier exists for PolyForm Shield, so this is name+url
      // rather than `identifier` — B652.
      license: {
        name: "PolyForm Shield 1.0.0",
        url: "https://polyformproject.org/licenses/shield/1.0.0",
      },
    },
    servers: [{ url: site.url }],
    security: [{ agentToken: [] }],
    components: {
      securitySchemes: {
        agentToken: {
          type: "http",
          scheme: "bearer",
          description:
            "An agent token from /api/auth/verify. Seven days, scoped to one " +
            "journal, write:content. A guest session cookie is not accepted here.",
        },
      },
      schemas: {
        Error: errorSchema,
        GeocodeCoordinate: {
          type: "object",
          required: ["lat", "lng"],
          properties: {
            lat: { type: "number", description: "Decimal degrees, -90 to 90." },
            lng: { type: "number", description: "Decimal degrees, -180 to 180." },
          },
        },
        GeocodeRequest: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description:
                "The place name to look up — `Bangkok`, `Hausen`, `Hoi An old town`. The answer is " +
                "a shortlist of candidates, not a silent best guess.",
            },
            countryHint: {
              type: "string",
              description:
                "Optional extra context — a country name or code, if the person gave one. It " +
                "helps the ranking and narrows collisions like `Hausen`.",
            },
            regionHint: {
              type: "string",
              description:
                "Optional province/state/canton hint, again only if the person gave one. Sent to " +
                "the provider as part of the search text, not written anywhere itself.",
            },
            contextCoordinates: {
              type: "array",
              description:
                "Optional nearby days' coordinates — what the surrounding trip already knows. " +
                "Used only to bias ranking towards the same area; an ambiguous name still comes " +
                "back as several candidates.",
              items: { $ref: "#/components/schemas/GeocodeCoordinate" },
            },
          },
        },
        GeocodeCandidate: {
          type: "object",
          required: ["displayName", "country", "lat", "lon"],
          properties: {
            displayName: {
              type: "string",
              description:
                "A human-readable label for disambiguation — the string to read back to the " +
                "person when several places share a name.",
            },
            country: { type: "string" },
            countryCode: {
              type: "string",
              description: "ISO-3166 alpha-2 country code, when the provider supplies one.",
            },
            adminRegion: {
              type: "string",
              description: "State, canton, province, county or closest named subdivision, when the provider has one.",
            },
            lat: { type: "number" },
            lon: { type: "number" },
            type: {
              type: "string",
              description:
                "What kind of place the provider thinks this is — city, village, hamlet, suburb, and so on. Omitted when the provider named no place kind.",
            },
          },
        },
        Trip: {
          type: "object",
          properties: {
            id: { type: "string" },
            ref: { type: "string", description: "<username>/<trip-id>" },
            title: { type: "string" },
            start: { type: "string", format: "date" },
            end: { type: "string", format: "date" },
            status: {
              type: "string",
              enum: ["current", "upcoming", "past"],
              description:
                "`current` is declared in the trip; `past` and `upcoming` are derived " +
                "from `start` on every read, so this reports the calendar's answer " +
                "rather than whatever the file says.",
            },
            visibility: { type: "string", enum: VISIBILITY_ENUM },
            listed: {
              type: "boolean",
              description:
                "Whether the trip is advertised — sitemap, feed, trip switcher. Separate " +
                "from visibility since W27: what an unlisted-but-public trip used to mean. " +
                "Read from the trip's `listed:` key where that narrows what visibility " +
                "already implied, so a `guest` or `private` trip is always false here.",
            },
            teaser: {
              type: "boolean",
              description:
                "Whether a *closed* trip says that it exists: a `guest` or `private` trip carrying " +
                "this gets a locked card on `/<user>/trips` with its title, its dates and " +
                "nothing else — no cover, no counts, no route — linking to its own sign-in " +
                "gate. Refused with `invalid_teaser` on a public trip, where `listed` is the " +
                "key that decides. Never a reading right: who may open the trip is " +
                "`visibility` alone.",
            },
            days: { type: "integer" },
            entries: { type: "integer" },
            drafts: { type: "integer" },
          },
        },
        Cost: {
          type: "object",
          required: ["label", "amount"],
          description: "One thing paid for on this day, in the currency it was paid in.",
          properties: {
            label: { type: "string", description: "What it was. Not a category — a thing." },
            amount: {
              type: "number",
              description:
                "As spent, in `currency`. Never converted on the way in: the journal " +
                "converts for display and keeps what was actually paid.",
            },
            currency: {
              type: "string",
              description:
                "ISO-4217, e.g. EUR. Omit it and the currency of the country this day was " +
                "in is written in instead — the day's `country`, or what its `lat`/`lng` " +
                "resolve to, falling back to the journal's own base currency when the day " +
                "says neither. The resolved code is stamped onto the line as it is written " +
                "and reported back as `costCurrency`, so what is on disk always says what " +
                "was spent (B542).",
            },
            category: {
              type: "string",
              enum: [...COST_CATEGORIES],
              description:
                'One of these seven, or omit it and the line is "other". It is a closed ' +
                "list, not free text: an unlisted category is refused with 400, so a " +
                '"shopping" line does not quietly become something else.',
            },
          },
        },
        Traveller: {
          type: "object",
          description:
            "One walking figure. **`for` is an email address out of the trip's `people:` " +
            "block, not a name** — that is what ties the drawing to a person, and it is the " +
            "single commonest way this call is refused. Every other key is a look, and the " +
            "values each one takes are published by GET /api/v1/{user}/travellers/presets " +
            "along with twelve worked examples: ask it rather than guessing, because an " +
            "unrecognised value is refused and an unrecognised key is refused too. " +
            "GET …/travellers/preview draws a figure so a person can see themselves before " +
            "it is written, which is the honest way to settle \"is this you?\".",
          additionalProperties: false,
          properties: Object.fromEntries(
            [...FIGURE_FIELDS].sort().map((field) => [
              field,
              field === "for"
                ? {
                    type: "string",
                    format: "email",
                    description: "An address in this trip's people: block.",
                  }
                : field === "accessories"
                  ? { type: "array", items: { type: "string" } }
                  : { type: "string" },
            ]),
          ),
        },
        GalleryItem: {
          type: "object",
          required: ["src", "type"],
          description:
            "A photograph or clip on a day. **You do not compose these** — POST to the media " +
            "endpoint and it puts them in the day for you. The one part that is yours is " +
            "`caption` and `visibility`: send `captions` and `visibility` alongside the " +
            "files, or PATCH the day later. Everything else is measured off the file.",
          properties: {
            src: { type: "string", description: "/{user}/media/{trip}/{day}/01.jpg" },
            type: { type: "string", enum: ["image", "video"] },
            width: { type: "integer" },
            height: { type: "integer" },
            caption: {
              type: "string",
              description:
                "One line about this photograph — what you were told about it, never what it " +
                "looks like to you. No invented weather, no invented names. An empty caption " +
                `beats a plausible one. One line, at most ${CAPTION_MAX_CHARS} characters; a ` +
                "line break is refused rather than folded.",
            },
            visibility: {
              type: "string",
              enum: [...PHOTO_VISIBILITIES],
              description:
                "This one photograph, held back from readers the trip otherwise lets in. " +
                "Absent for almost every picture, which is what \"everyone the trip lets " +
                "in\" looks like. `guest` is everybody the owner has let into the journal, " +
                "plus the people who were on the trip; `private` is the people who were " +
                "there, and the owner. **It narrows and never widens** — there is no " +
                "`public` value, and a `guest` label on a `private` trip stays private, " +
                "because a label cannot let anybody past the gate the trip is holding. " +
                "A labelled photograph is absent from the gallery, from the day, and from " +
                "every payload for a reader below its level, and the file itself answers " +
                "404 rather than being one guessable URL away.",
            },
            poster: { type: "string", description: "A still, for a clip." },
            from: {
              type: "string",
              description:
                "What the file was called when it was sent — `IMG_4821.JPG`. Everything " +
                "else here is server-assigned and in position order, so this is the only " +
                "thing that tells you *which* of your files a day holds. After a batch " +
                "that was refused, read the day back and compare this rather than " +
                "counting: a resume by count duplicates some files and drops others. " +
                "Absent on days written before this existed.",
            },
          },
        },
        Draft: {
          type: "object",
          required: ["title", "date", "content"],
          description:
            "The body of POST /api/v1/{user}/trips/{trip}/days. Everything but title, date " +
            "and content is optional — and an omitted field is better than an invented one. " +
            "There is no `status`: what this writes is always a draft.",
          properties: {
            title: {
              type: "string",
              description:
                "What the day is called. One line, and it becomes the slug — no two days " +
                "in a trip may share one.",
            },
            date: { type: "string", format: "date", description: "2026-08-26. A real calendar date." },
            time: {
              type: "string",
              pattern: "^\\d{2}:\\d{2}$",
              description: "24-hour, local to where the day happened. Orders several days that share a date.",
            },
            timezone: {
              type: "string",
              description:
                "The IANA name `time` is local to — `\"Asia/Bangkok\"`, never a numeric offset. " +
                "Absent falls back to the journal's own zone when `time` is read — the RSS " +
                "`pubDate` and the on-page dual clock both need one, and neither guesses it " +
                "from `lat`/`lng`. A name `Intl` does not recognise is refused.",
            },
            location: { type: "string", description: "Where this was, as a person would say it — a town, a place." },
            country: { type: "string", description: "The country's name, not its code." },
            countryCode: {
              type: "string",
              pattern: "^[A-Za-z]{2}$",
              description:
                "ISO 3166-1 alpha-2 — PT, CH, VN. It draws the flag beside the day, and it is " +
                "the code where `country` is the name; sending one without the other is fine.",
            },
            lat: {
              type: "number",
              description:
                "Decimal degrees, -90 to 90, as a number and never a string. A pair or " +
                "nothing: half a coordinate is not a place and is refused. This is what puts " +
                "the day on the map.",
            },
            lng: { type: "number", description: "Decimal degrees, -180 to 180. Must arrive with lat." },
            content: { type: "string", description: "The prose, as markdown." },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Lowercase letters, digits and single hyphens.",
            },
            costs: {
              type: ["array", "boolean", "string"],
              items: { $ref: "#/components/schemas/Cost" },
              description:
                "What this day cost, each line in the currency it was paid in — or " +
                "`false`, meaning *nothing was spent on this day*, or `\"unknown\"`, " +
                "meaning *money was spent and nobody has the figures*.\n\n" +
                "A trip that tracks costs refuses a day that says none of the three (422 " +
                "`incomplete_day`). All three are honest and the difference is kept: " +
                "`false` writes `without: [costs]`, `\"unknown\"` writes " +
                "`unrecorded: [costs]`, and a reader years from now can tell *there was " +
                "none* from *nobody wrote it down* from *nobody asked*.\n\n" +
                "**Do not send `false` where you mean `\"unknown\"`.** Cash somebody paid " +
                "and cannot remember is the third answer, not the second — and the costs " +
                "page counts an unrecorded day as a zero and says so, rather than quietly " +
                "reporting a total that is too low. Never invent a figure.",
            },
            transportMode: {
              type: "string",
              enum: [...TRANSPORT_MODES],
              description:
                "How the day was travelled — it draws the leg from the previous day. " +
                "Anything not on this list is refused rather than dropped.",
            },
            transportFrom: { type: "string", description: "Where the leg started." },
            transportTo: { type: "string", description: "Where it ended." },
            travelScene: {
              type: "string",
              enum: [...TRAVEL_SCENE_VARIANTS],
              description:
                `How the travel scene into this day plays. One of ${TRAVEL_SCENE_VARIANTS.join(", ")} ` +
                "changes anything; \"skip\" leaves the leg out of the story pager entirely. " +
                "Absent plays the default scene, timed to the distance covered. Any other " +
                "string is written as sent and read back as the default rather than refused.",
            },
            weather: {
              type: "boolean",
              description:
                "`true` asks this server to look up what the weather actually was at this day's "
                + "`lat`/`lng` on this `date`, from the Open-Meteo public archive, and write it into "
                + "the day. It needs coordinates: a day without them gets nothing, never a guess "
                + "from the trip's other days or the nearest city. The lookup cannot fail this "
                + "call — a day the archive has no answer for yet is filled in later by "
                + "`npm run weather:update`. It needs the `weather` capability: with it off, this "
                + "call is refused (400, `weather_disabled`) and nothing is written, rather "
                + "than accepted and quietly dropped — B778. /api/health says whether this "
                + "server provides it.",
            },
            weatherData: {
              type: "object",
              description:
                "A reading somebody actually took, for the case where you have one and the archive "
                + "does not. **You may not write this from your own knowledge.** It is accepted "
                + "only with `source` — where the reading came from, in a few words — and "
                + "`recordedAt`, an ISO instant; and `open-meteo` is refused as a source, because "
                + "that name means this server retrieved a measurement and a reader takes it that "
                + "way. At least one of tempMin, tempMax, code (a WMO code), precipitation (mm) or "
                + "windMax (km/h). If what you want is the archive's answer, send `weather: true` "
                + "instead. Once this is written it is the server's own record of a measurement, "
                + "not a claim of yours to take back on a second thought — see `weatherData` on "
                + "`DraftPatch` before ever sending this field `null`.",
            },
            translations: {
              type: "object",
              description:
                "This day's title and prose in the journal's other languages, keyed by " +
                "locale: `{\"en\": {\"title\": \"…\", \"content\": \"…\"}}`. " +
                "**Required when the journal declares more than one locale** — a day " +
                "without them is refused (400), because half the readers would get a blank " +
                "page. The locale the day is already written in is refused here, and so is " +
                "one the journal does not declare. The words are the owner's: do not " +
                "translate their prose yourself unless they ask, and say so in your reply " +
                "if you do. If the journal is really written in one language, that is the " +
                "journal's to fix — PATCH its config with a single-entry `locales`.",
              additionalProperties: {
                type: "object",
                properties: { title: { type: "string" }, content: { type: "string" } },
              },
            },
            coordinates: {
              type: ["boolean", "string"],
              description:
                "`\"unknown\"` is the third answer: it happened somewhere and nobody can say where. Better than a plausible pin — an invented place is a lie the map tells confidently." +
                "\n\n`false`, and only on create — *this day has no one place to put " +
                "on a map*. The positive answer is `lat` and `lng`; there is no " +
                "`coordinates: true`. A trip that tracks location refuses a day that says " +
                "neither (422 `incomplete_day`).",
            },
            photos: {
              type: ["boolean", "string"],
              description:
                "`\"unknown\"` is the third answer: there are pictures somewhere and nobody has them to hand. They can be added later; the day does not have to wait." +
                "\n\n`false`, and only on create — *this day has no photographs*. " +
                "Pictures never arrive in this body; they are a separate call to " +
                "…/media. A trip that tracks photos checks for them at publish rather than " +
                "here, so this is what lets a day without any go up.",
            },
            test: {
              type: "boolean",
              description:
                "This day did not happen — it was written to check that the software works. " +
                "The page shows a banner saying so, and the day is kept out of the feed, the " +
                "search index and the sitemap. Set it whenever you were asked to invent " +
                "content; a string here is refused rather than ignored.",
            },
            visibility: {
              type: "string",
              enum: [...PHOTO_VISIBILITIES],
              description:
                "This whole update, held back from readers the trip otherwise lets in — " +
                "the same two words `GalleryItem.visibility` takes, meaning the same two " +
                "populations, and it **narrows and never widens**: there is no `public` " +
                "value, and a `guest` day inside a `private` trip stays private. Absent for " +
                "almost every day, which is what \"everyone the trip lets in\" looks like. " +
                "A labelled day is absent from the page, the feed, the sitemap and the " +
                "search index for a reader below its level, and its markdown twin answers " +
                "as though the day did not exist.",
            },
            idempotency_key: {
              type: "string",
              description:
                "Names this one write. Send the same key with the same body to retry after a " +
                "dropped connection and you get the first answer back with `replayed: true`; " +
                "send it with a different body and the call is refused (409) and nothing is " +
                "written. A new key for every day.",
            },
            dryRun: {
              type: "boolean",
              description:
                "Run every check this call would run — shape, the trip's own contract, " +
                "weather-capability, whatever this trip tracks — and write nothing: no " +
                "draft, no idempotency record. A clean body answers `200 { ok: true, " +
                "written: false, dryRun: true }`; a bad one answers the exact `400`/`422` " +
                "the real POST would, because it is the same checks running either way. " +
                "This is how you check a folder of content against the instance before " +
                "pushing it — read `/content-model.json` for the frontmatter-to-field " +
                "mapping, then send each day here first. Absent or `false` behaves exactly " +
                "as before.",
            },
          },
        },
        DayEdit: {
          type: "object",
          description:
            "The body of PATCH /api/v1/{user}/trips/{trip}/days/{slug}. Every field is " +
            `optional — send only what you are changing (${EDITABLE_DAY_FIELDS.join(", ")}). ` +
            "There is no `status` here, and there cannot be: publishing and unpublishing " +
            "happen only through POST .../publish. A field this omits is left exactly as " +
            "it was, formatting included — this is a textual edit, not a rewrite.",
          properties: {
            title: { type: "string" },
            date: { type: "string", format: "date", description: "2026-08-26" },
            time: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
            timezone: {
              type: "string",
              description: "Same meaning as on creation — the IANA name `time` is local to.",
            },
            location: { type: "string" },
            country: { type: "string", description: "The country's name, not its code." },
            countryCode: {
              type: "string",
              pattern: "^[A-Za-z]{2}$",
              description: "ISO 3166-1 alpha-2 — the flag beside the day.",
            },
            lat: { type: "number" },
            lng: { type: "number", description: "Must arrive with lat in the same call." },
            content: { type: "string", description: "Replaces the entry's whole body." },
            tags: { type: "array", items: { type: "string" } },
            costs: {
              type: "array",
              items: { $ref: "#/components/schemas/Cost" },
              description: "Replaces the whole list. An empty array clears it.",
            },
            transportMode: { type: "string", enum: [...TRANSPORT_MODES] },
            transportFrom: { type: "string" },
            transportTo: { type: "string" },
            travelScene: {
              type: "string",
              enum: [...TRAVEL_SCENE_VARIANTS],
              description: `Same meaning as on creation. One of ${TRAVEL_SCENE_VARIANTS.join(", ")}.`,
            },
            visibility: {
              type: "string",
              enum: [...PHOTO_VISIBILITIES],
              description:
                "Same meaning as on creation, and — unlike `photoVisibility` — writable here " +
                "too, since this is one scalar on the day itself rather than a label matched " +
                "against a photograph's `src`. `null` clears it, the same as `photoVisibility` " +
                "does; there is no `public` to ask for, for the same reason.",
            },
            translations: {
              type: "object",
              description:
                "Replaces the whole block, locale by locale — the same shape as on creation. " +
                "A locale the journal does not declare is refused, and so is the one the day " +
                "is written in.",
              additionalProperties: {
                type: "object",
                properties: { title: { type: "string" }, content: { type: "string" } },
              },
            },
            captions: {
              type: "object",
              description:
                "A caption per photograph, keyed by the item's `src` exactly as the day " +
                "reads it back. **Edit only** — there is no way to send one at creation, " +
                "because the pictures do not exist yet; the media call takes captions of its " +
                `own. At most ${CAPTION_MAX_CHARS} characters each. An empty string removes ` +
                "one. A `src` the day does not have is refused rather than ignored, so a " +
                "typo cannot silently caption nothing.",
              additionalProperties: { type: "string" },
            },
            photoVisibility: {
              type: "object",
              description:
                "One photograph held back, keyed by the item's `src` exactly as the day " +
                "reads it back — the same keys `captions` takes. **Edit only**, for the " +
                "same reason: the pictures do not exist at creation, and the media call " +
                "takes labels of its own. `null` clears a label. There is no `public` — a " +
                "label narrows what the trip's own `visibility` already allows and can " +
                "never widen it, so `null` is how a photograph goes back to being seen by " +
                "everyone the trip lets in, and sending `\"public\"` is refused with that " +
                "sentence rather than quietly accepted. A `src` the day does not have is " +
                "refused rather than ignored: \"I have marked that photograph private\" " +
                "followed by nothing landing is the worst answer this field could give.",
              additionalProperties: { type: "string", enum: [...PHOTO_VISIBILITIES] },
            },
            coordinates: {
              type: "string",
              enum: ["unknown"],
              description:
                "The only value this field takes here — B599. `\"unknown\"` says it happened " +
                "somewhere and nobody can say where, and can be sent about a day that already " +
                "exists exactly as it can at creation. **`false` is refused on this route** — " +
                "it is the answer given when a day is written (`false` in " +
                "`components.schemas.Draft`, create-only by design), not something an " +
                "existing day can be told afterwards; a day that has always had no one place " +
                "already carries that answer from creation. To place the day, send lat and " +
                "lng instead.",
            },
            photos: {
              type: "string",
              enum: ["unknown"],
              description:
                "The only value this field takes here — B599. `\"unknown\"` says there are " +
                "pictures somewhere and nobody has them to hand, and is exactly the case this " +
                "route exists for: a day published without them can say so afterwards, " +
                "whenever that becomes true, without waiting on the pictures. **`false` is " +
                "refused on this route** — it is the answer given when a day is written " +
                "(`false` in `components.schemas.Draft`, create-only by design). Pictures " +
                "never arrive in this body; POST them to .../media.",
            },
            weather: {
              type: "boolean",
              description:
                "Same meaning as on creation, and the way to have a day already written looked " +
                "up. `false` withdraws the request; it does not remove a reading already " +
                "recorded. `true` on a journal whose `weather` capability is off is refused " +
                "(400, `weather_disabled`) and nothing is written — B778.",
            },
            weatherData: {
              type: "object",
              description:
                "Same rules as on creation — a `source` and a `recordedAt` are required and " +
                "`open-meteo` is refused. `null` removes a reading, for real — send it only " +
                "when you were told the reading was wrong or the day changed, never because a " +
                "block of weather on a day you did not write looks fabricated to you: it is not " +
                "evidence that it was, and deleting a real measurement to comply with that guess " +
                "is a worse mistake than leaving it alone.",
            },
            test: {
              type: "boolean",
              description: "Same meaning as on creation. `false` removes the flag.",
            },
          },
        },
        Budget: {
          type: "object",
          required: ["total", "days"],
          description:
            "A trip's planned total, in `components.schemas.Costs`. Both fields are required " +
            "and must be positive — a zero or missing total is refused with a `problems` entry " +
            "rather than written and read back as no budget at all, which is what " +
            "lib/costFormat.ts's parseBudget does silently for a page render (B263).",
          properties: {
            total: { type: "number", description: "Planned total for the whole trip." },
            days: { type: "number", description: "How many days the budget was drawn up for." },
            currency: {
              type: "string",
              description: "ISO-4217, e.g. CHF. Omit it and the journal's own base currency is used.",
            },
          },
        },
        Costs: {
          type: "object",
          description:
            "The body of PUT and PATCH " +
            "/api/v1/{user}/trips/{trip}/costs — a trip's planned budget, its preparation " +
            "spending, and the owner's own prose about the money. On PUT, `budget` is " +
            "required; on PATCH every field is optional, and `budget: null` clears the " +
            "budget alone without touching `costs` or `body`.",
          properties: {
            budget: { $ref: "#/components/schemas/Budget" },
            costs: {
              type: "array",
              items: { $ref: "#/components/schemas/Cost" },
              description:
                "Preparation costs — visas, gear, the rail pass bought before leaving. Same " +
                "shape as a day's `costs`, and refused the same way: an unknown category, or " +
                "an amount that is zero or negative, is a `problems` entry rather than a silent " +
                "drop. Replaces the whole list when sent; an empty array clears it.",
            },
            body: { type: "string", description: "The trip's own prose about the money." },
          },
        },
        RouteStop: {
          type: "object",
          required: ["location", "lat", "lng"],
          description: "One stop on a trip's intended route.",
          properties: {
            location: { type: "string", description: "The name of the stop, as a person would write it." },
            country: { type: "string" },
            countryCode: { type: "string", description: "ISO 3166-1 alpha-2, e.g. CH." },
            lat: { type: "number", description: "-90 to 90." },
            lng: { type: "number", description: "-180 to 180." },
            note: { type: "string", description: "A line about why this stop is on the route." },
          },
        },
        Plan: {
          type: "object",
          description:
            "The body of PUT /api/v1/{user}/trips/{trip}/plan — a trip's intended route and " +
            "the owner's own prose about it. Replaces the whole file when sent; an absent or " +
            "empty `route` writes a plan with no stops yet.",
          properties: {
            route: {
              type: "array",
              items: { $ref: "#/components/schemas/RouteStop" },
              description: "The stops, in the order they are meant to happen.",
            },
            body: { type: "string", description: "The trip's own prose about the route." },
          },
        },
      },
    },
    paths: {
      "/api/auth/request": {
        post: {
          summary: "Ask for a one-time code",
          security: [],
          description:
            "Always answers 202, whether or not the address owns anything — so " +
            "it cannot be used to discover which addresses exist. Two " +
            "exceptions, and neither of them varies with the address: an agent " +
            "code for an address that neither owns the journal nor is on the trip " +
            "you named answers 403 rather than leaving you waiting for a code that " +
            "was never coming, and a server with mail switched off answers 503 " +
            "`mail_disabled` rather than issuing a code it has no way to deliver.\n\n" +
            "**A new request invalidates the previous code.** Two of these mails " +
            "look identical apart from the time in them, and only the newest code " +
            "works — so if you ask twice, make sure the person reads out the " +
            "newest one.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user", "email"],
                  properties: {
                    user: {
                      type: "string",
                      description:
                        "The journal's address — the same segment that appears in its URLs. " +
                        "Called `username` when a journal is created; the same value.",
                    },
                    email: { type: "string", format: "email" },
                    kind: {
                      type: "string",
                      enum: ["agent", "guest"],
                      default: "guest",
                      description: "`agent` for a token that can write.",
                    },
                    trip: {
                      type: "string",
                      description:
                        "For somebody who is on a trip but does not own the journal. The " +
                        "token then writes to that trip and nothing else.",
                    },
                    destination: {
                      type: "string",
                      description:
                        "Where the one-tap link in the mail should land, for the browser " +
                        "sign-in form: the path the reader was on. Guest codes only — an " +
                        "agent code has no link. It is stored with the code and never " +
                        "appears in the mailed URL, and anything that is not a path inside " +
                        "`/{user}/` is ignored, landing the reader on the journal instead.",
                    },
                    channel: {
                      type: "string",
                      enum: ["email", "whatsapp"],
                      default: "email",
                      description:
                        "How the code travels. `whatsapp` sends it as a WhatsApp message " +
                        "to the number the journal's owner proved at signup — so it only " +
                        "ever delivers for the owner's own address; anything else answers " +
                        "the same 202 with nothing sent, exactly like an unknown address " +
                        "by mail. A server without WhatsApp answers 503 " +
                        "`whatsapp_disabled`.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Accepted" },
            "400": {
              description:
                "`invalid_user` — `user` is missing. Or `invalid_email` — `email` is " +
                "missing or not a syntactically valid address. Both are shape checks that " +
                "never touch a lookup, so refusing them names nothing about who is " +
                "registered — unlike an unrecognised-but-valid address, which still " +
                "answers 202.",
            },
            "403": { description: "That address may not have an agent code for this journal" },
            "404": { description: "Authentication is off on this server" },
            "429": { description: "Too many attempts" },
            "503": {
              description:
                "`mail_disabled` — this server cannot send mail at all, so nothing was " +
                "issued and any code you already hold is still live. Or `mail_failed` — " +
                "the send was attempted and broke, so no code is live for this address " +
                "and retrying is the remedy. `whatsapp_disabled` and `whatsapp_failed` " +
                "are the same two answers for `channel: \"whatsapp\"`.",
            },
          },
        },
      },
      "/api/auth/verify": {
        post: {
          summary: "Exchange a code for a token",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user", "email", "code"],
                  properties: {
                    user: { type: "string" },
                    email: { type: "string", format: "email" },
                    code: { type: "string", description: `Six digits. ${CODE_TTL_MINUTES} minutes, single use.` },
                    kind: { type: "string", enum: ["agent", "guest"], default: "guest" },
                    trip: {
                      type: "string",
                      description:
                        "Optional, and only ever the same trip named at /api/auth/request: the " +
                        "trip travels on the code, and the token is scoped to it whether or not " +
                        "this is sent. Naming a different one is refused with 401. The journal's " +
                        "owner may name one here to narrow a code they asked for unqualified.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "A token, its expiry and its scope" },
            "401": { description: "Invalid code" },
          },
        },
      },
      /**
       * Deletion is two calls in two places, and the OpenAPI document has to
       * say so or an agent reads `202` as success.
       */
      "/api/v1/{user}": {
        delete: {
          summary: "Ask to delete a journal (deletes nothing; mails the owner)",
          description:
            "**This deletes nothing.** It answers 202 and mails the address that owns the " +
            "journal a link to a page with a button; only that button deletes. The link is " +
            "single-use, expires in an hour, and the caller cannot follow it — that is the " +
            "point, because the confirmation for something irreversible must not be " +
            "completable by the same agent that asked for it. Report that a mail is waiting, " +
            "never that the journal is gone. Owner only: a trip-scoped token is refused.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "202": {
              description:
                "A confirmation was mailed. The body names the address and what would go, " +
                "and carries `\"deleted\": false`.",
            },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "The token belongs to a different journal, or is scoped to one trip. Writing " +
                "to a trip and deleting the journal around it are different authorities.",
            },
            "404": { description: "No such journal, or this server cannot send mail" },
            "409": { description: "The journal's config.json has no owner.email to mail" },
            "410": { description: "This journal was already deleted" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}": {
        get: {
          summary: "One trip, whole — everything the create call accepts",
          description:
            "Added because five fields `POST .../trips` invites you to set — `accent`, " +
            "`costsVisibility`, `intro`, `translations`, `test` — could be written and read " +
            "back nowhere: the trips list is a summary and the dedicated doors cover only " +
            "visibility, rates, people, travellers and tracks. **Read your own work back " +
            "with this before telling somebody a trip is ready.** \"It was accepted\" is not " +
            "the same claim as \"it is there\", and this API has been wrong about the " +
            "difference. Gated as a write is rather than as a read, because it carries " +
            "`people`, which is addresses.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The trip, its party, its rates and what it tracks" },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": {
              description:
                "No such trip, or none this token may write to — the two answer alike, so " +
                "this cannot be used to ask which trips a journal has.",
            },
          },
        },
        patch: {
          summary: "Rename a trip, move its dates, correct its intro, its cover or its translations",
          description:
            "Nine fields of a trip nothing could write until B622 (four), B245 (`cover`), " +
            "B907 (`accent`, `costsVisibility`, `intro`) and B1496 (`translations`): `title`, " +
            "`tagline`, `start`, `end`, `cover`, `accent`, `costsVisibility`, `intro` and " +
            "`translations`. Send only what is changing. A " +
            "title cannot be cleared — a trip.md without one does not load — while an emptied " +
            "`tagline`, `cover`, or `accent` sent as `null`/`\"\"` removes the key rather than " +
            "storing an empty one, and an emptied `costsVisibility` clears back to the " +
            "default, `public`. Dates are `YYYY-MM-DD`, and `end` may not precede `start`: " +
            "the check is against the *result*, so either date may arrive on its own. `cover` " +
            "must be a `src` this trip's own gallery already carries — read " +
            "`GET .../trips/{trip}/media` for the list — since a value naming a photo the trip " +
            "does not have would render as a broken image on the trips index and the OG " +
            "card. `intro` is the trip's own prose, not a frontmatter line, and any text is " +
            "accepted including empty. `translations` replaces the whole block rather than " +
            "merging into it — send the trip's title and tagline in every language it should " +
            "keep, and a locale you leave out is dropped; `null` or `{}` clears it " +
            "altogether. A locale this journal does not declare is refused in the same words " +
            "`POST .../trips` refuses it in, because it is the same check.\n\n" +
            "**`visibility`, `listed`, `teaser`, `status` and `test` are not here.** The " +
            "first three have their own door, `PATCH .../trips/{trip}/visibility`, which " +
            "enforces rules this call must not carry a second, driftable copy of — an " +
            "unrecognised visibility reads as private, `listed: true` on a trip nothing " +
            "advertises is refused, `teaser: true` on a public trip is refused. `status` is " +
            "derived from the calendar at almost every reading path rather than a fact a " +
            "correction changes, and `test` on a trip that has already published real days is " +
            "a bigger decision than fixing a typo — both stay file-only for now.\n\n" +
            "Only the frontmatter lines you name are rewritten (and, when `intro` is named, " +
            "the prose below them). The rest — the prose when `intro` is not named, the key " +
            "order, and every other key — is left byte for byte, so this is safe on a " +
            "trip.md somebody wrote by hand.\n\n**Owner only.** A trip-scoped token belongs " +
            "to somebody who was on the journey, and adding a day to it is not the same " +
            "authority as saying what it is called.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string", description: "One line. Cannot be cleared." },
                    tagline: {
                      type: "string",
                      description: "One line. Empty string removes it rather than writing one.",
                    },
                    start: { type: "string", description: "YYYY-MM-DD." },
                    end: {
                      type: "string",
                      description: "YYYY-MM-DD, and not before `start`.",
                    },
                    cover: {
                      type: "string",
                      description:
                        "A `src` from this trip's own gallery (`GET .../trips/{trip}/media`). " +
                        "`null` or empty string clears it. A value naming a photo the trip " +
                        "does not have is refused rather than written.",
                    },
                    accent: {
                      type: "string",
                      enum: [...ACCENTS],
                      description:
                        "Which of five colours this trip's cards and OG image draw in. " +
                        "`null` or empty string clears it back to no preference.",
                    },
                    costsVisibility: {
                      type: "string",
                      enum: [...COSTS_VISIBILITIES],
                      description:
                        "Who among the readers who may open the trip may also see what it " +
                        "cost — decides nothing about who may open the trip itself. `null` or " +
                        "empty string clears it back to the default, `public`.",
                    },
                    intro: {
                      type: "string",
                      description:
                        "The trip's own prose, not a frontmatter line. Any text is accepted, " +
                        "including empty.",
                    },
                    translations: {
                      type: "object",
                      description:
                        "The trip's title and tagline in the journal's other languages, keyed " +
                        'by locale: `{"de": {"title": "…", "tagline": "…"}}`. Replaces the ' +
                        "whole block — the same shape, and the same check, as on creation — " +
                        "so a locale left out is dropped. `null` or `{}` clears it. A locale " +
                        "this journal does not declare is refused, and an entry saying " +
                        "neither a title nor a tagline is refused rather than written, since " +
                        "the reader drops an empty one and the write would only look like it " +
                        "took.",
                      additionalProperties: {
                        type: "object",
                        properties: { title: { type: "string" }, tagline: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "The fields named, as they now stand on disk" },
            "400": {
              description:
                "A body naming none of the nine (`nothing_to_change`), a cleared or " +
                "multi-line title (`invalid_title`), a date that is not one — an `end` " +
                "before the `start` is the same `invalid_date` — a `cover` naming a photo " +
                "not in this trip's gallery (`invalid_cover`), an `accent` not in the enum " +
                "(`invalid_accent`), a `costsVisibility` not in the enum " +
                "(`invalid_costs_visibility`), or a `translations` block that is not an " +
                "object keyed by declared locales (`invalid_translations`) — and nothing is " +
                "written in any of those cases",
            },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "A trip-scoped token: it writes days into the trip and cannot rename it",
            },
            "404": {
              description:
                "No such trip, or none this token may write to — the two answer alike",
            },
          },
        },
        delete: {
          summary: "Ask to delete a trip (deletes nothing; mails the owner)",
          description:
            "**This deletes nothing** — same flow as deleting a journal. One difference " +
            "worth repeating to the person: deleting a *day* leaves its photographs on disk, " +
            "and deleting a *trip* takes them with it. Owner only; somebody listed in the " +
            "trip's `people:` may write days into it and may not delete it.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "202": { description: "A confirmation was mailed; nothing is deleted yet" },
            "401": { description: "Missing or invalid token" },
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such trip, or this server cannot send mail" },
            "410": { description: "This trip was already deleted" },
          },
        },
      },
      "/api/v1/{user}/deletions/{token}": {
        post: {
          summary: "Confirm a deletion (from the mailed page, not from an agent)",
          description:
            "The button on the confirmation page. There is deliberately no GET: mail " +
            "scanners and link previewers follow links, and a GET that destroyed a journal " +
            "would eventually be followed by a robot. The token is the credential and it " +
            "arrived in the owner's mailbox — an agent holding it has read somebody's mail " +
            "and should not be using it.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "token", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Deleted" },
            "404": { description: "No such token for this journal" },
            "409": { description: "The link was already used, or it has expired" },
            "410": { description: "What it pointed at has already gone" },
            "429": { description: "Too many attempts" },
          },
        },
      },
      /**
       * The two links that let other people in — B33.
       *
       * Listed with the write API rather than under authentication, because
       * that is what they are: an owner-only write that produces a URL. The
       * description has to carry one warning the schema cannot, and it is the
       * only warning that matters here — a buddy link ends in write access.
       */
      "/api/v1/{user}/postcards/recipients": {
        get: {
          summary: "Who a printed postcard could be addressed to",
          description:
            "A name, a town and a country each — **and never a street**. An agent addresses a " +
            "card by `contactId` and never holds anybody's home address, which is what makes " +
            "it impossible to post one to an address that was invented or mistyped in a " +
            "conversation.\n\n" +
            "Everybody here is an `active` contact of this journal who asked for a real " +
            "postcard and left an address themselves. Owner only.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description:
                "`creditsEach`, and a `recipients` array of contact ids, each with the language " +
                "this journal writes to that person in",
            },
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such journal, or postcards or contacts are off on it" },
          },
        },
      },
      "/api/v1/{user}/postcards": {
        post: {
          summary: "Propose a set of postcards, for a person to send",
          description:
            "Writes a draft order and answers with a URL. **It charges nothing and prints " +
            "nothing.**\n\n" +
            "There is deliberately no endpoint that sends. Not an owner-only one — none at " +
            "all: the send is a button on the page this returns, because printing and posting " +
            "spends real money and ends up in somebody's letterbox, which is not a decision to " +
            "take on their behalf. Hand the `url` over and stop; do not report the cards as " +
            "sent, or as being sent. `GET .../postcards/{id}` says later whether they went.\n\n" +
            "Owner only, and the recipients must be ids from `.../postcards/recipients`. A day " +
            "is where a photograph is *found*, not something the card needs: give both `trip` " +
            "and `day`, or neither and name a photograph staged in the inbox instead.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["photo", "message", "from", "recipients"],
                  properties: {
                    trip: {
                      type: "string",
                      description: "The trip id. Given together with `day`, or omitted with it.",
                    },
                    day: {
                      type: "string",
                      description: "The slug of the day the card is from. Given together with `trip`.",
                    },
                    photo: {
                      type: "string",
                      description:
                        "With `trip` and `day`: a path relative to the trip's media directory, " +
                        "already in the trip. Without them: an id `GET .../inbox` answered — a " +
                        "photograph staged there and no day, so its order belongs to no trip.",
                    },
                    message: {
                      type: "string",
                      maxLength: 600,
                      description:
                        "What is written on the back, in the author's own words about what " +
                        "they actually told you. One person who knows them reads this, which " +
                        "makes an invented detail worse rather than more forgivable.",
                    },
                    from: { type: "string", description: "The signature on the card." },
                    locale: {
                      type: "string",
                      description:
                        "What language the card is written in. Defaults to the journal's own " +
                        "default. Nothing inspects the words and decides — a wrong language " +
                        "asserted confidently is worse than the sensible default. It changes " +
                        "nothing about what is printed; it is compared against each " +
                        "recipient's own language so the owner can notice a mismatch before " +
                        "the button. `.../postcards/recipients` reports theirs.",
                    },
                    recipients: {
                      type: "array",
                      maxItems: 25,
                      items: { type: "string" },
                      description:
                        "Contact ids from `.../postcards/recipients`. Anything else is " +
                        "refused by name — there is no way to address a card to somebody who " +
                        "did not ask this journal for one.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "The order: its `id`, the `url` a person opens to look at and send it, what it " +
                "will cost and what the journal has left. Nothing has been charged.",
            },
            "400": { description: "A missing field, a photo not in the trip, a test day, or a recipient who cannot be posted to" },
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such journal, trip or day, or postcards are off" },
            "503": { description: "No database, so an order has nowhere to live" },
          },
        },
      },
      "/api/v1/{user}/postcards/{id}": {
        get: {
          summary: "Where one postcard order stands",
          description:
            "`draft` is waiting for a person, `expired` is past its week, `printed` means the " +
            "cards went to a printer — which is not the same as delivered, and nothing here " +
            "will ever know that. Owner only.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The order, its cost and its status" },
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such order in this journal" },
          },
        },
      },
      "/api/v1/{user}/photobooks/{id}": {
        get: {
          summary: "Where one photobook order stands",
          description:
            "What it is, what it cost, and — once it has been bought printed from the trip's " +
            "photobook page — who it went to, by `contactId`, and at what quote. **Never a " +
            "street address.** `providerRef` only appears once the printer has actually taken " +
            "the order; there is no separate press to call from here, because a photobook is " +
            "bought and printed in one motion on the owner's own trip page (B1157) rather than " +
            "proposed by an agent and pressed later. Owner only.\n\n" +
            `\`size\` is one of \`${Object.keys(BOOK_SIZES).join("\`, \`")}\`, and \`coverType\` ` +
            `is one of \`${COVER_TYPES.join("\`, \`")}\` — the two the order was actually built ` +
            "with, not every combination the catalogue offers: not every size exists in both " +
            "covers (`sizesFor` in `lib/photobook/spec.ts` says which does).",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The order, its build, and its print proposal if it has one" },
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such order in this journal, or photobooks are off" },
          },
        },
      },
      "/api/v1/{user}/invites": {
        get: {
          summary: "Every invite link this journal has issued",
          description:
            "Never the tokens: only their hashes were stored, so a link that was lost has to " +
            "be reissued rather than looked up. Owner only.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Links, with their kind, scope, expiry, uses and revocation" },
            "403": {
              description:
                "Not this journal's owner — checked before contacts is, so this also " +
                "covers a journal that does not exist. B340.",
            },
            "409": {
              description: "This journal's own owner, but contacts are off on it (`contacts_disabled`)",
            },
          },
        },
        post: {
          summary: "Issue a guest link or a buddy link",
          description:
            "**Neither link grants anything.** Whoever opens one proves their own address and " +
            "lands in the owner's approval queue; the owner lets each person in by hand. So a " +
            "link is an invitation to ask, and reporting one as \"they now have access\" is " +
            "false.\n\n" +
            "`guest` leads to reading the journal — every trip marked `visibility: guest`, and " +
            "never one marked `private`. It is journal-wide; there is no per-trip guest link. " +
            "Safe to forward.\n\n" +
            "`buddy` needs a `trip` and leads to **write access** to that trip, plus the " +
            "journal's guest trips once approved. It is for the people who were actually on " +
            "the trip and **is not the one to paste into a group chat** — say which kind you " +
            "are handing over.\n\n" +
            "The token appears in this response once and is stored only hashed. Owner only: a " +
            "trip-scoped token may write days into its trip and may not invite people to it.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["kind"],
                  properties: {
                    kind: {
                      type: "string",
                      enum: ["guest", "buddy"],
                      description: "`buddy` grants write access to one trip once approved.",
                    },
                    trip: {
                      type: "string",
                      description:
                        "Required for `buddy`, and refused for `guest` — being let into a " +
                        "journal is never narrowed to one trip. Hold a trip back from the " +
                        "people you have let in by marking it `private`.",
                    },
                    name: {
                      type: "string",
                      description:
                        "Whom it is for. Prefill for the greeting on the landing page, never " +
                        "identity: whoever opens the link types their own address.",
                    },
                    locale: { type: "string", description: "The language the page opens in." },
                    days: {
                      type: "integer",
                      default: 30,
                      description:
                        "How long the link stays live. There is no never — a link that does " +
                        "not expire is the shared password again, wearing a URL.",
                    },
                    email: {
                      type: "string",
                      description:
                        "Mail the link to this address, in the recipient's own language, and " +
                        "pre-approve it — B319. Whoever proves this exact address at the " +
                        "landing page is admitted with no queue and no second decision from " +
                        "the owner. Proof still happens: a wrong or forwarded address grants " +
                        "nothing to anybody. Optional; omit it to get back a link to send " +
                        "yourself.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "The link. `url` is present exactly once, in this response; `scope` is the " +
                "journal, or a `<user>/<trip>` ref for a buddy link. `sent` says whether an " +
                "`email` given above actually left — `false` still means the link and its " +
                "pre-approval both exist, so hand `invite.url` over another way rather than " +
                "reading a failed send as a failed invitation.",
            },
            "400": { description: "No kind, a guest link with a trip, or a buddy link without" },
            "403": {
              description:
                "Not this journal's owner — checked before contacts is, so this also " +
                "covers a journal that does not exist. B340.",
            },
            "404": { description: "No such trip, for a buddy link" },
            "409": {
              description: "This journal's own owner, but contacts are off on it (`contacts_disabled`)",
            },
          },
        },
      },
      "/api/v1/{user}/invites/{id}": {
        delete: {
          summary: "Revoke one link",
          description:
            "The link stops working and **everybody already approved stays in** — which is the " +
            "whole reason these exist rather than a shared password, which could only be " +
            "changed for everyone at once. Nothing anybody wrote is removed, so unlike " +
            "deleting a journal or a trip this needs no mailed confirmation.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Revoked" },
            "403": {
              description:
                "Not this journal's owner — checked before contacts is, so this also " +
                "covers a journal that does not exist. B340.",
            },
            "404": { description: "No such link in this journal" },
            "409": { description: "This journal's own owner, but contacts are off on it" },
          },
        },
      },
      "/api/v1/{user}/trips": {
        get: {
          summary: "Every trip in this journal",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Trips" },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
          },
        },
        post: {
          summary: "Create a trip (owner only; defaults to this journal's own visibility)",
          // B302: the summary said which value you get by *default* and never
          // which to ask for, so an agent reading only the schema had less to
          // go on than one reading the prose. Both sentences come from
          // `lib/api/agentCopy.ts`, where the guide takes them too.
          description: `${VISIBILITY_ENUM_NOTE}\n\n${PRIVATE_SHUTS_OUT_GUESTS}`,
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "title", "start", "end"],
                  properties: {
                    id: { type: "string", description: "URL segment: lowercase, digits, dashes." },
                    title: {
                      type: "string",
                      description: "What the trip is called. One line.",
                    },
                    start: { type: "string", description: "2027-04-01. Required — a trip without dates is never read." },
                    end: { type: "string", description: "2027-05-15. Required." },
                    tagline: { type: "string", description: "One line under the trip's title." },
                    status: {
                      type: "string",
                      enum: [...STATUSES],
                      description:
                        "Optional, and usually omitted: `past`/`upcoming` are derived " +
                        "from `start` when the trip is read. Set `current` for the trip " +
                        "served at the bare /{user} URL.",
                    },
                    accent: {
                      type: "string",
                      enum: [...ACCENTS],
                      description: "The trip's colour, through its pages and its map.",
                    },
                    visibility: {
                      type: "string",
                      // Most open first, which is the order a person decides
                      // in — B302. No `default` here any more (B306): the
                      // actual default is not one fixed value, it is this
                      // journal's own visibility — see VISIBILITY_ENUM_NOTE.
                      enum: VISIBILITY_ENUM,
                      description: VISIBILITY_ENUM_NOTE,
                    },
                    listed: {
                      type: "boolean",
                      description:
                        "Only ever narrows. `false` on a public trip is the old " +
                        "`unlisted`: readable by anybody holding the link, and in no " +
                        "sitemap, feed or switcher. `true` alongside a visibility that " +
                        "advertises nothing is refused with `invalid_listed` rather " +
                        "than written, since the reader would refuse it too.",
                    },
                    teaser: {
                      type: "boolean",
                      description:
                        "Names a closed trip on `/<user>/trips` without opening it — a locked " +
                        "card carrying the title and the dates, linking to the trip's own " +
                        "sign-in gate. Only on a `guest` or `private` trip; `true` alongside " +
                        "`visibility: public` is refused with `invalid_teaser`, since a public " +
                        "trip is already advertised by `listed`.",
                    },
                    costsVisibility: {
                      type: "string",
                      enum: [...COSTS_VISIBILITIES],
                      description:
                        "Who may see what the trip cost, once they can read the trip at " +
                        "all — a different question from `visibility`, which decides who " +
                        "gets in. `public` is the default and means anybody who can read " +
                        "the trip can read its money; `guests` narrows that to somebody " +
                        "who was on the trip or whom the owner has approved into the " +
                        "journal. There is no editing interface anywhere in this product, " +
                        "so this call is the only way an owner can reach it (B178).",
                    },
                    tracks: {
                      type: "object",
                      description:
                        "What this trip keeps track of, and therefore what every day " +
                        "written into it is asked for. **Absent means all of them on**, " +
                        "which is the default an owner should not have to find: a day " +
                        "missing one is refused with 422 `incomplete_day` and told both " +
                        "how to send it and how to decline it. Turn one off here for a " +
                        "trip where the question does not apply — a city weekend nobody " +
                        "is costing, say. Changed later at PATCH .../tracks.",
                      properties: Object.fromEntries(
                        TRACKS.map((track) => [track, { type: "boolean" }]),
                      ),
                    },
                    travellers: {
                      type: "array",
                      maxItems: 10,
                      description:
                        "How the party is drawn — the walking figures on the trip's map " +
                        "and story. Cosmetic, and therefore not owner-only the way " +
                        "`people` is. Ask GET /api/v1/{user}/travellers/presets for the " +
                        "vocabulary and twelve starting points, and " +
                        "GET …/travellers/preview to show somebody the figure before it " +
                        "is written. An unknown key inside a figure is refused with " +
                        "`invalid_travellers` rather than dropped.",
                      items: { $ref: "#/components/schemas/Traveller" },
                    },
                    test: {
                      type: "boolean",
                      description:
                        "This trip did not happen — it exists to check that the software " +
                        "works. Every day of it gets a banner saying so, and none of it " +
                        "reaches the feed, the search index or the sitemap.",
                    },
                    intro: {
                      type: "string",
                      description:
                        "The prose under the trip's own heading — what this journey is, in " +
                        "the person's words rather than a summary you write.",
                    },
                    people: {
                      type: "array",
                      maxItems: 10,
                      description:
                        "Who took the trip. It is the byline AND it is write access: " +
                        "everyone named may write to the whole trip and may obtain a token " +
                        "scoped to it, using the address given. A malformed entry is refused " +
                        "by name (`invalid_people`) rather than dropped, which is what the " +
                        "reader does with one. Correctable afterwards at " +
                        "PATCH .../trips/{trip}/people, which replaces the whole list.\n\n" +
                        "**Never infer an address.** An agent moving a journal onto a server " +
                        "found a person with a name and no email and filled in the owner's, " +
                        "which is a reasonable-looking guess that hands somebody write access " +
                        "to a trip. If you do not have the address, ask for it; a person " +
                        "listed with the wrong one is worse than a person not listed yet.",
                      items: {
                        type: "object",
                        required: ["name", "email"],
                        properties: {
                          name: { type: "string" },
                          email: { type: "string", format: "email" },
                          nickname: { type: "string" },
                        },
                      },
                    },
                    rates: {
                      type: "object",
                      additionalProperties: { type: "number" },
                      description:
                        "This trip's frozen rates: units of the journal's BASE currency for " +
                        "one unit of the keyed currency. `{\"THB\": 0.0245}` is " +
                        "\"1 THB = 0.0245 CHF\", so a currency worth less than the base one " +
                        "has a small number — the ECB reference table points the other way. " +
                        "Omitting a currency is supported: its costs are reported as " +
                        "unconverted rather than converted at a guess.",
                    },
                    translations: {
                      type: "object",
                      description:
                        "Title and tagline in the journal's other languages, keyed by locale: " +
                        "`{\"de\": {\"title\": \"Japan\"}}`. A locale the journal does not " +
                        "declare is refused rather than written, since nothing would render it.",
                      additionalProperties: {
                        type: "object",
                        properties: { title: { type: "string" }, tagline: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Created. `next` names the call that writes the first day and links the " +
                "skill document for it (B311), so a caller that cannot follow a link found " +
                "inside a fetched document still learns where it is.",
            },
            "400": { description: "The id, title, dates, people, rates or translations are not usable" },
            "401": { description: "Missing or invalid token" },
            "403": { description: "Another journal's token, or one scoped to a single trip" },
            "409": { description: "A trip with that id already exists" },
          },
        },
      },
      "/api/auth/signup/request": {
        post: {
          summary: "Ask for a code to create a journal (no journal needed yet)",
          description:
            "There is no journal yet, so there is no `user.locales` to read and no contact " +
            "record carrying a language — the mail this sends is the first thing the software " +
            "ever says to this address. Absent `locale`, it reads the request's own " +
            "`Accept-Language` header, honouring quality values, and falls back to English " +
            "when that names nothing this instance maintains.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", format: "email" },
                    locale: {
                      type: "string",
                      enum: [...MAINTAINED_LOCALES],
                      description:
                        `One of ${LOCALE_LIST}. Overrides \`Accept-Language\` outright — sent, ` +
                        "it wins with no reconciliation between the two and no warning either way.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Accepted — a code is mailed if the address is usable" },
            "404": { description: "Signing up is not enabled on this server" },
            "429": { description: "Too many attempts" },
            "503": { description: "This server cannot send mail, so signing up cannot finish" },
          },
        },
      },
      "/api/auth/signup/verify": {
        post: {
          summary: "Exchange the code for a token that can create one journal",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "code"],
                  properties: {
                    email: { type: "string", format: "email" },
                    code: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "A signup token. It creates exactly one journal and is spent by doing so; " +
                "unused, it expires in twenty minutes. A refused creation — a taken or " +
                "malformed username — does not spend it, so a correctable mistake can be " +
                "corrected without another emailed code.",
            },
            "401": { description: "The code is wrong, expired or already used" },
            "409": {
              description:
                "The code was right, and that is the problem: the address it proved " +
                "already owns as many journals as this server allows (`too_many_journals`, " +
                "naming them). No token is returned — creating would only be refused the " +
                "same way later. The `next` field says how to get a write token for the " +
                "journal it already owns instead. Checked only after the code verifies, so " +
                "this route stays useless for asking who is on this server. B1568.",
            },
          },
        },
      },
      // B1134: this route's siblings under /api/auth/identity (verify,
      // upgrade, link) stay out of this document on purpose — they set and
      // read the browser cookie an agent's bearer token can never use, per
      // OUT_OF_SCOPE_PREFIXES in test/openapi-contract.test.ts. This one is
      // different: it is a plain "ask for a code" step, the same shape as
      // /api/auth/signup/request, and had simply never gained an entry here
      // at all — not a deliberate exclusion, a gap.
      "/api/auth/identity/request": {
        post: {
          summary: "Ask for a code that proves an address to the whole instance — B410",
          security: [],
          description:
            "Names no journal: this proves an address, not a right to read or write one. " +
            "Always answers 202, for the same reason every code endpoint here does — an " +
            "answer that distinguished \"no such address\" from \"sent\" is a way to ask who " +
            "reads this server.\n\n" +
            "Absent `locale`, the mail is sent in whatever the reader's browser session " +
            "already carries — the language cookie the site's own switcher sets, or its own " +
            "`Accept-Language` fallback when there is no session at all (B430) — because an " +
            "identity belongs to no journal, so there is no `user.locales` and no contact " +
            "record to read a language from either.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", format: "email" },
                    locale: {
                      type: "string",
                      enum: [...MAINTAINED_LOCALES],
                      description:
                        `One of ${LOCALE_LIST}. Overrides the browser session outright — sent, ` +
                        "it wins with no reconciliation and no warning either way.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Accepted — a code is mailed if the address is usable" },
            "404": { description: "Authentication is off on this server" },
            "429": { description: "Too many attempts" },
            "503": { description: "This server cannot send mail, so signing in cannot finish" },
          },
        },
      },
      "/api/auth/signup/phone/request": {
        post: {
          summary: "Prove a telephone number, step one — B1065/B1234",
          description:
            "The second half of proving who is signing up, after the address. Takes the " +
            "signup token from /api/auth/signup/verify. The `phone_required` refusal on " +
            "POST /api/v1/journals carries a `mode` saying which shape this server runs. " +
            'In `"code"` mode a passcode is sent to `tel`, which must carry its own ' +
            "country code — this server is not standing in any country, so a national " +
            "number is refused rather than guessed; rate-limited per number, per address " +
            "and for the whole server, since every attempt may cost the operator money. " +
            'In `"whatsapp-inbound"` mode (B1234) send **no body**: the answer carries a ' +
            "wa.me `link` whose prefilled `text` holds a one-time token — the person " +
            "opens it and sends the message, and the number it arrives from is thereby " +
            "proven. No code exists in that mode; poll the verify endpoint instead. " +
            "Where that answer (and the `phone_required` refusal) says `smsFallback: true`, " +
            'a caller with no WhatsApp may instead send `{"channel": "sms", "tel": …}` — ' +
            "B1316 — and a passcode arrives by SMS, verified the code-mode way. The " +
            "server's number may only reach some countries (`sms_unreachable` names the " +
            "restriction); the WhatsApp path has no such limit.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tel: {
                      type: "string",
                      description:
                        'Code mode only: a telephone number with its country code, e.g. ' +
                        '"+41 76 000 00 00". Ignored in whatsapp-inbound mode unless ' +
                        '`channel` is "sms".',
                    },
                    channel: {
                      type: "string",
                      enum: ["sms"],
                      description:
                        "B1316: in whatsapp-inbound mode, ask for the passcode by SMS " +
                        "instead of confirming through WhatsApp. Only honoured where the " +
                        "refusal that sent you here said `smsFallback: true`; ignored in " +
                        "every code mode, where the server's configured backend decides " +
                        "the delivery.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "202": {
              description:
                "Accepted — `id` names this verification attempt. Code mode: a passcode " +
                "is on its way; pass `id` and the code to /api/auth/signup/phone/verify. " +
                'Whatsapp-inbound mode: `mode` is "whatsapp-inbound" and `link`/`text` ' +
                "carry the wa.me link and its prefilled message; poll the verify endpoint " +
                "with `id` and no code. `smsFallback` says whether `channel: \"sms\"` is " +
                "also on offer.",
            },
            "400": {
              description:
                "tel is missing or not a number with a country code, or `sms_unreachable`: " +
                "the server's SMS number cannot reach this number's country — use the " +
                "WhatsApp confirmation instead",
            },
            "401": { description: "Missing or invalid signup token" },
            "404": {
              description:
                "Signing up is not enabled on this server, or `sms_disabled`: " +
                '`channel: "sms"` was asked for and this server cannot send SMS',
            },
            "429": {
              description:
                "Too many attempts for this number (3/day), this address (5/day), or this " +
                "server as a whole (50/day)",
            },
            "503": { description: "The code could not be sent" },
          },
        },
      },
      "/api/auth/signup/phone/verify": {
        post: {
          summary: "Prove a telephone number, step two — B1065/B1234",
          description:
            "Takes the signup token, the `id` from the request step, and — in code mode — " +
            "the code. On success the proven number is attached to the signup token " +
            "itself — nothing further to send; POST /api/v1/journals reads it " +
            "automatically. **Leaving `code` out is the poll** for whatsapp-inbound mode " +
            '(B1234): the answer is `{"status": "pending"}` until the person\'s message ' +
            'arrives, then the same success shape; `{"status": "expired"}` means ask the ' +
            "request step for a fresh link.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id"],
                  properties: {
                    id: { type: "string", description: "From the request step's response." },
                    code: {
                      type: "string",
                      description: "Code mode only. Absent = poll the whatsapp-inbound proof.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Proven — `tel` echoes the number this token now carries. Or, polling " +
                'without a code: `{"status": "pending"}` / `{"status": "expired"}`.',
            },
            "401": { description: "The code is wrong, expired or already used, or the token is invalid" },
            "404": { description: "Signing up is not enabled on this server" },
            "429": { description: "Too many attempts" },
          },
        },
      },
      "/api/v1/geocode": {
        post: {
          summary: "Turn a place name into candidate coordinates",
          description:
            "A helper for writing a day's `lat`/`lng` when the person named a place but did not " +
            "know the numbers. **Returns a shortlist, never one silent answer**: if several " +
            "candidates fit, ask which one they meant rather than picking one on their behalf. " +
            "A `200` with `results: []` means the provider found nothing; it is not an error.\n\n" +
            "Needs the journal's `addressLookup` capability. `countryHint` and `regionHint` " +
            "narrow the search when the person gave them, and `contextCoordinates` biases the " +
            "ranking towards where the surrounding days already were.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GeocodeRequest" },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Ranked candidates. Empty `results` is a genuine no-match; read non-empty ones back to the person and ask which they meant.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["results"],
                    properties: {
                      results: {
                        type: "array",
                        items: { $ref: "#/components/schemas/GeocodeCandidate" },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description:
                "The request body is not usable — most often `query` missing, too short, too long, or `contextCoordinates` not an array of `{lat,lng}` objects",
            },
            "401": { description: "Missing or invalid token" },
            "404": { description: "This journal does not have place lookup switched on" },
            "429": { description: "Too many lookups too quickly — wait `Retry-After` seconds" },
            "502": { description: "The upstream geocoder could not be reached or answered something unusable" },
          },
        },
      },
      "/api/v1/journals": {
        post: {
          summary: "Create a journal",
          description:
            "Takes the signup token. A journal needs a proven telephone number as well as " +
            "a proven address (B1064) — complete /api/auth/signup/phone/request and " +
            "/api/auth/signup/phone/verify with the same token first, unless the address " +
            "is this instance's operator or the username starts with \"test-\", both " +
            "exempt. Answers with an agent token for the journal it just created, so the " +
            "caller can go straight on to creating a trip. The 201's `next` names that " +
            "call and links the skill document for it (B311) — a response is not a " +
            "fetched page, so this is a URL a caller that cannot follow a link found " +
            "inside a document can still reach.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "username",
                    "title",
                    "ownerName",
                    "ownerNickname",
                    "visibility",
                    "defaultLocale",
                    "locales",
                    "baseCurrency",
                  ],
                  properties: {
                    username: { type: "string", description: "The journal's address. Permanent." },
                    title: {
                      type: "string",
                      description:
                        "What the journal is called — the heading on its front page. Ask; do " +
                        "not invent one from the username.",
                    },
                    tagline: {
                      type: "string",
                      description: "One line under the title. Theirs, not a description you write.",
                    },
                    ownerName: { type: "string", description: "Whose journal it is, as they would write it. It is the byline." },
                    ownerNickname: {
                      type: "string",
                      description:
                        "What the site calls them, in its own voice. Never guessed from " +
                        "ownerName — a first-word split mangles any name whose given name " +
                        "is not first, so there is no safe guess. Ask. That includes the " +
                        "case where the owner is the person you are talking to and has " +
                        "just given you their name: ask them \"what should the site call " +
                        "you?\" rather than inferring it. There is no default, and that " +
                        "is deliberate.",
                    },
                    visibility: {
                      type: "string",
                      // `guest`, not `private` — B306 renamed this level's closed
                      // value so it stops borrowing the trip's word for a
                      // different meaning. `"private"` is still accepted on the
                      // wire (normalizeJournalVisibility) but is not offered here.
                      enum: ["public", "guest"],
                      // No `default`: silence used to be read as `public`, which is
                      // exactly the field that decides whether a stranger can come
                      // across somebody's journal (B263). Required — ask.
                      // The same two sentences the /skill/*.md guides and
                      // /documentation.txt carry, from the one place they are written.
                      description:
                        `Required — there is no default. Whether this server advertises the ` +
                        `journal: ${VISIBILITY_MEANING} ` +
                        `${VISIBILITY_NOT_A_LOCK.replace(/`/g, "")} Ask which they want.`,
                    },
                    startLocation: { type: "string", description: "Where the maps open before a trip has begun — the place they set off from." },
                    defaultLocale: {
                      type: "string",
                      enum: [...MAINTAINED_LOCALES],
                      // No `default`: silently falling back to English is the other
                      // half of B263 — the welcome mail, the first thing this
                      // software says to the owner, arrived in the wrong language.
                      description:
                        `Required — there is no default. The language the owner writes in, ` +
                        `${LOCALE_LIST}. Sets the language of the site's own chrome and of ` +
                        "the welcome mail sent the moment the journal is created.",
                    },
                    locales: {
                      type: "array",
                      items: { type: "string", enum: [...MAINTAINED_LOCALES] },
                      // No `default`: B277 — the same silent shape B263 found in
                      // visibility and defaultLocale, one field over. Left
                      // optional, a journal asked for three languages got one,
                      // with no switcher to reach the other two.
                      description:
                        `Required — there is no default. Which languages a reader may switch ` +
                        `the journal into, as distinct from defaultLocale, the owner's own. ` +
                        `Must include defaultLocale. Each entry must be one of ${LOCALE_LIST}. ` +
                        // B855: the field that quietly commits the owner to writing
                        // everything twice. Same sentence as the guide and the 201.
                        plain(SECOND_LANGUAGE_COMMITMENT),
                    },
                    baseCurrency: {
                      type: "string",
                      // No `default`: it was `CHF`, silently, and unlike every
                      // other field on this route there is no correcting it —
                      // PATCH /api/v1/{user}/config refuses it. B839.
                      description:
                        "Required — there is no default, and this is the only field here that " +
                        "can never be changed. ISO-4217. Every cost anywhere in the journal is " +
                        "added up in it; what was actually paid is never converted on the way " +
                        "in. Tell them it is permanent when you ask.",
                    },
                    displayCurrencies: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Shown beside the base currency, so a reader sees both. Each an " +
                        "ISO-4217 code, and the list must include baseCurrency. Omit it to " +
                        "offer the base currency alone.",
                    },
                    units: { type: "string", enum: ["metric", "imperial"], description: "metric or imperial — distances and temperatures." },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Created, with an agent token for it. Also `signIn` — a one-time sign-in " +
                "URL **for the owner, not for you**: put it in your reply so they can open " +
                "their journal without going to their inbox, and it lets them see drafts " +
                "and private trips. Single use, expires in 15 minutes, and never to be " +
                "handed over as the journal's address (that is `url`). Do not follow it " +
                "yourself — opening it spends it. Hand it over straight away: asking for a " +
                "sign-in code for that address invalidates an unused one early. The " +
                "owner's welcome mail carries a **second, standing** link to the same " +
                "place — a different token with no expiry, not this one. `signInNote` " +
                "carries the same instruction as one sentence, for pasting into a reply. " +
                "Both are absent when this server has auth off. When `locales` has more than " +
                "one entry the reply also carries `localesNote`: " +
                plain(SECOND_LANGUAGE_COMMITMENT) +
                " `next` names the call that creates the first trip and links the skill " +
                "document for it (B311).",
            },
            "400": {
              description:
                "The username, title or owner name/nickname is not usable, or visibility, " +
                "defaultLocale, locales or baseCurrency is missing or not a value this server " +
                "accepts, or locales does not contain defaultLocale, or displayCurrencies does " +
                "not contain baseCurrency, or (`phone_required`) no proven number is attached " +
                "to this signup token yet.",
            },
            "401": { description: "Missing or invalid signup token" },
            "403": { description: "This address already owns as many journals as it may" },
            "404": { description: "Signing up is not enabled on this server" },
            "409": { description: "That username is taken, or that phone number already belongs to another journal" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/days": {
        get: {
          summary: "Every day in a trip, drafts included",
          description:
            "Not only the published ones, whatever this summary said until B540: a draft " +
            "comes back flagged `draft: true`, because an agent reading a trip back needs " +
            "to see what it has written and not yet put on the site.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Days" }, "404": { description: "No such trip" } },
        },
        post: {
          summary: "Add a day, as a draft",
          description:
            "Always creates a draft. A retry that finds its own earlier write " +
            "gets 409 rather than overwriting it — send an `idempotency_key` to " +
            "get the first answer back instead. Photographs are not part of this " +
            "body: POST them to the media endpoint, which adds them to the day.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Draft" } },
            },
          },
          responses: {
            "200": {
              description:
                "Replayed: this idempotency_key had already been used for this exact call, " +
                "and nothing was written again. Or `dryRun: true` with a clean body — " +
                "`{ ok: true, written: false, dryRun: true }` — every check passed and " +
                "nothing was written; the two cases both answer 200 and never collide with " +
                "the 201 a real write gets.",
            },
            "201": {
              description:
                "Created as a draft. `next` points at the photographs skill document " +
                "(B311), for a caller that cannot follow a link found inside a document.",
            },
            "400": {
              description:
                "Invalid entry. The body carries a `problems` list — every problem at once, " +
                "each naming the field, what arrived and what was expected. Also " +
                "`weather_disabled`: `weather: true` on a journal whose weather capability " +
                "is off, refused with nothing written rather than accepted and never looked " +
                "up (B778).",
            },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": {
              description:
                "No such trip, or none this token may write to — the two answer alike, so a " +
                "trip-scoped token cannot enumerate the journal's others. `auth_disabled` " +
                "instead means this server has authentication off entirely.",
            },
            "409": {
              description:
                "An entry already exists for that date and title, or an idempotency_key was " +
                "reused for a different day.",
            },
            "422": {
              description:
                "`incomplete_day` — the day says nothing about something this trip keeps " +
                "track of. Not a malformed request: `missing` names each field with what to " +
                "send and, equally, how to decline it (`\"costs\": false`). Never invent a " +
                "value to satisfy this; ask the person, or decline.",
            },
          },
        },
        delete: {
          summary: "Delete a draft day",
          description:
            "Deletes a **draft** only. Refused the first time on purpose: the " +
            "first call answers 409 with a signed `confirm` code and a question; " +
            "repeat the call with that code to go through. The code is bound to " +
            "the journal, trip, day and verb, and lasts five minutes. The entry " +
            "file is removed; its photographs are left on disk.\n\n" +
            "**A published day is not deleted here.** It answers 409 " +
            "`published_day_not_deletable` with no code that could ever satisfy " +
            "it — destroying content people have already read is not a self-served " +
            "round trip (B224, B1118). Take the day off the site first with " +
            "`POST .../days/{slug}/unpublish`, which is reversible; that makes it a " +
            "draft, and a draft deletes the normal way.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["slug"],
                  properties: {
                    slug: { type: "string" },
                    confirm: {
                      type: "string",
                      description: "The code from the 409. Omit it to be issued one.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Deleted (draft only)" },
            "400": { description: "No such day" },
            "409": {
              description:
                "Confirmation required — the body carries the code — or " +
                "`published_day_not_deletable` if the day is on the site (unpublish it first)",
            },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/days/{slug}/publish": {
        post: {
          summary: "Publish a draft",
          description:
            "Puts a draft on the site, in one call. **Ask the person first, in words, and " +
            "wait for an answer.** Nothing here can check that you did, so that sentence " +
            "is the whole of the safeguard: publishing is your work to do, and deciding " +
            "is theirs.\n\n" +
            "Owner only: a token scoped to a single trip writes days into it and cannot put " +
            "them on the site. Nothing sent to the days POST can publish — writing and " +
            "publishing are two calls, which is what gives them a moment to read the day " +
            "back, and it is the only part that is structural.\n\n" +
            "**Not an update.** This does exactly one thing — remove the line holding a day " +
            "back — and it is not how you correct a day, before or after it is on the site: " +
            "that is PATCH .../days/{slug}. A day already published answers 409 here rather " +
            "than accepting new content under the name \"publish\".\n\n" +
            "It does not really come back. Taking a day down removes it from the journal, " +
            "the feed and the search index, not from the people who have read it.\n\n" +
            "**`send_mail: true` sends a letter about this day** to every reader who may see " +
            "it, in their own language — B345. Its absence means no letter, and that default " +
            "never changes: publishing several days must not mail one letter per day to " +
            "everybody the owner knows. The response's `mail` field reports how many went, " +
            "never who to. A failed send never fails the publish; it shows up in `mail` " +
            "instead. Owner only, same as the publish itself. See " +
            "`/api/v1/{user}/trips/{trip}/days/{slug}/send-mail` to send it again afterwards.\n\n" +
            "**`send_whatsapp: true` does the same on WhatsApp** — B365 — and obeys the " +
            "same default: absent means nothing is sent. Both flags may be given at once, " +
            "and each reports separately (`mail`, `whatsapp`) so one channel failing tells " +
            "you nothing false about the other. Its readers are a narrower set: only " +
            "contacts who ticked the WhatsApp box and left a usable number, because Meta " +
            "requires opt-in to WhatsApp specifically and the digest's consent does not " +
            "carry over.\n\n" +
            "**Both flags must be the JSON boolean `true`** — B400. `\"send_mail\": \"true\"` " +
            "(a string) or `1` is not read as yes; it is ignored the same as if it had never " +
            "been sent, and nothing goes out for it. That case is reported rather than left " +
            "silent: the response carries `flagsIgnored` (e.g. `[\"send_mail\"]`) and a " +
            "`flagsIgnoredMessage` naming which key was present but not a boolean. Absence of " +
            "the key stays silent — that is the honest \"did not ask\" — only a present, " +
            "wrong-typed value is called out.\n\n" +
            "**Email to readers is free; WhatsApp costs credits where this server charges " +
            "for them.** A letter costs nothing whatever the size of the readership (B840), " +
            "so `send_mail` on its own can never be refused for money. `send_whatsapp` is " +
            "one credit per message (B366). The requested channels are priced together " +
            "against one balance *before* anything is published: if the journal cannot " +
            "cover the whole send, this answers **402** with `needed` and `balance`, the " +
            "day stays a draft and nothing is sent. It is all-or-nothing, so a partial " +
            "delivery is never the outcome. A publish with neither flag is never charged " +
            "and never refused for credits. `GET /api/v1/{user}/status` carries the " +
            "balance; read it first rather than discovering an empty account here. Nothing " +
            "an agent holds can add credits — `POST /api/v1/{user}/credits/purchase` " +
            "answers with a link for the owner to open — so a 402 is a message to pass on, " +
            "never something to retry around.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    send_mail: {
                      type: "boolean",
                      description:
                        "Mail every entitled reader about this day once it is published. " +
                        "Absent or false sends nothing.",
                    },
                    send_whatsapp: {
                      type: "boolean",
                      description:
                        "Message every entitled reader who opted in to WhatsApp and left a " +
                        "usable number. Absent or false sends nothing.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Published; the body carries the day's public URL, and `note` says who can " +
                "now read it. That answer is the trip's, not the publish's: a public trip's " +
                "day is in the feed and the search index and readable by anyone with the " +
                "link, a `guest` trip's by the people the owner has approved into the " +
                "journal, and a `private` trip's by the people on the trip — B775. Read the " +
                "note out; do not paraphrase it into \"it is live\".",
            },
            "400": { description: "The day could not be published — the body says why" },
            "402": {
              description:
                "Not enough credits for the send this call asked for — which since B840 " +
                "means `send_whatsapp`, mail being free. Nothing was published and nothing " +
                "was charged; `needed` and `balance` say by how much.",
            },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "Another journal's token, or one scoped to a single trip — which may write " +
                "days but not publish them",
            },
            "404": { description: "No such trip, or no such day" },
            "409": { description: "That day is already on the site" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/days/{slug}/unpublish": {
        post: {
          summary: "Take a published day back off the site",
          description:
            "The day becomes a draft again: off the site, off the feed, off the sitemap, " +
            "still on disk with every word and every photograph. **It is not a delete** — " +
            "nothing is removed, and publishing it again puts it back exactly as it was. " +
            "That is why this needs none of deletion's ceremony. " +
            "Owner only, like publishing: a trip-scoped token may write days into its trip " +
            "and may neither put them on the site nor take them off. " +
            "Nothing is sent and nothing is spent, and there is no channel that announces a " +
            "day coming down — somebody who already read it, or was sent it, still has what " +
            "they saw. Say that to the person if what they want is for nobody to have seen it.",
          operationId: "unpublishDay",
          tags: ["Days"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "The day is a draft again",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      slug: { type: "string" },
                      status: { type: "string", enum: ["draft"] },
                      url: { type: "string" },
                      note: {
                        type: "string",
                        description:
                          "What happened, in words to repeat: nothing was deleted, and " +
                          "anybody who already read it still has what they saw.",
                      },
                    },
                  },
                },
              },
            },
            "400": { description: "The day could not be taken down — the body says why" },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "Another journal's token, or one scoped to a single trip — which may write " +
                "days but not take them off the site",
            },
            "404": { description: "No such trip, or no such day" },
            "409": { description: "That day is not on the site" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/days/{slug}/send-mail": {
        post: {
          summary: "Send the letter for a published day, again",
          description:
            "B345's second trigger: mail every entitled reader about a day that is " +
            "**already** on the site, whether this is the first attempt or a repeat. " +
            "Owner only, for the same reason `/publish` is — a token scoped to one trip may " +
            "write days into it and must not be able to mail the journal's whole " +
            "readership.\n\n" +
            "**Not idempotent, on purpose.** Every call sends to everybody who currently " +
            "qualifies, whatever an earlier attempt sent — the owner asking again is the " +
            "whole of the safeguard, so ask in words before calling it a second time, the " +
            "same discipline as `/publish` itself. The response says `resend: true` and how " +
            "many letters went; never who to. A `test: true` day, or one still a draft, " +
            "refuses outright rather than sending nothing quietly.\n\n" +
            "**Free, whatever the size of the readership.** This answered 402 on an empty " +
            "balance until B840; it no longer costs credits and no longer refuses for " +
            "them. `/send-whatsapp` still does.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Sent (or attempted) — the body carries the count" },
            "400": {
              description:
                "Content nobody lived, or mail/contacts is not enabled here — the body says which",
            },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "Another journal's token, or one scoped to a single trip — which may write " +
                "days but not mail readers about them",
            },
            "404": { description: "No such trip, or no such day" },
            "409": { description: "That day is still a draft — nothing to send a letter about" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/days/{slug}/send-whatsapp": {
        post: {
          summary: "Announce a published day on WhatsApp, again",
          description:
            "B365, and the exact counterpart of `/send-mail` beside it: message every " +
            "entitled reader who opted in to WhatsApp about a day **already** on the site. " +
            "Owner only, and that reasoning is stronger here than for mail — a letter waits " +
            "in an inbox, this buzzes in somebody's pocket, and a reader who did not want it " +
            "reports the number rather than unsubscribing. Meta bans the number and the " +
            "journal loses the channel for everyone.\n\n" +
            "**Not idempotent, on purpose**, exactly like `/send-mail`. The response says " +
            "`resend: true` and how many went; a failure names its reason against a masked " +
            "number, never the number itself. A `test: true` day, or one still a draft, " +
            "refuses outright.\n\n" +
            "The words are fixed: WhatsApp permits only a template approved by Meta in " +
            "advance, so this fills variables in sentences already written. `no_template` " +
            "means readers opted in but no approved template exists for any language they " +
            "could be written in.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Sent (or attempted) — the body carries the count" },
            "400": {
              description:
                "Content nobody lived, WhatsApp or contacts not enabled here, or no approved " +
                "template for any reader's language — the body says which",
            },
            "402": {
              description:
                "Not enough credits for this send, where the server charges for them " +
                "(B366). Nothing was sent and nothing was charged; `needed` and `balance` " +
                "say by how much. Only the owner can add credits, from a shell on the " +
                "server — there is no purchase call, so this is a message to pass on " +
                "rather than something to retry around.",
            },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "Another journal's token, or one scoped to a single trip — which may write " +
                "days but not message readers about them",
            },
            "404": { description: "No such trip, or no such day" },
            "409": { description: "That day is still a draft — nothing to announce" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/days/{slug}": {
        get: {
          summary: "One day in full, drafts included",
          description:
            "The whole entry — content, gallery, costs, tags, translations, and `without` " +
            "for anything the day deliberately has none of — and a `status` " +
            "of `draft` or `published`. This is how you read back something you " +
            "have just written, before telling a person it is ready — translations included, " +
            "in the same shape they were written in. Scoped like " +
            "the writes on this path: a draft is what somebody has not decided " +
            "to publish, so it needs the same token.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The day" },
            "404": { description: "No such trip or day" },
          },
        },
        patch: {
          summary: "Edit a day that already exists",
          description:
            "Change one or more fields of a day already written — a coordinate that was " +
            "missing, a misspelled place, a date that was wrong. This is a textual edit: a " +
            "field this omits, and the file's own formatting, are left exactly as they were " +
            "— the same discipline POST .../media and the publish call already keep.\n\n" +
            "**Not how you publish or unpublish.** There is no `status` in the body " +
            "(`components.schemas.DayEdit`), and sending one is refused (400) with " +
            "nothing written — a day moves between draft and published only through " +
            "POST .../publish, never through this call. The response's `status` says " +
            "which one the day was left in, so it can be reported truthfully rather than " +
            "assumed: an earlier agent had no way to edit a day, reached for `/publish` " +
            "because it was the only verb that touched an existing file, and put fifteen " +
            "unreviewed days on somebody's site while reporting them as drafts (B266).\n\n" +
            "Same authority as writing the day: whoever may POST a day into this trip may " +
            "PATCH one, trip-scoped tokens included.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/DayEdit" } },
            },
          },
          responses: {
            "200": {
              description:
                "Edited. `status` is `draft` or `published` — the day's actual state, not " +
                "this call's intention — and `changed` lists the fields that were sent.",
            },
            "400": {
              description:
                "Invalid entry (a `problems` list, same shape as creation's), an empty " +
                "body, or a field this endpoint does not write — `status` included, named " +
                "in `unsupported_field` rather than silently dropped. `weather_disabled` " +
                "when `weather: true` is sent to a journal whose weather capability is off: " +
                "nothing is written, because the lookup that would answer it will never " +
                "run (B778).",
            },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": {
              description:
                "No such trip, or no such day — the two answer alike, so a trip-scoped " +
                "token cannot enumerate the journal's others.",
            },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/costs": {
        get: {
          summary: "A trip's budget and preparation costs, as stored",
          description:
            "The whole of `costs.md` — the budget, the preparation costs, the base currency " +
            "they default into, and the trip's own prose about the money. `exists: false` " +
            "means there is no `costs.md` yet, which is not an error: it is the same answer " +
            "an empty drafts list gives. This is how you read back what PUT or PATCH just " +
            "wrote, before telling the owner it is there.\n\n" +
            "Same authority as writing a day: whoever may write to this trip may read its " +
            "budget, trip-scoped tokens included.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The trip's costs.md, parsed" },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": { description: "No such trip" },
          },
        },
        put: {
          summary: "Write the whole costs.md",
          description:
            "Creates or wholly replaces a trip's budget, preparation costs and prose about " +
            "the money, in one call — the write half of B295: before it, a budget could only " +
            "be written by hand, over SSH or with the `add-a-trip` skill on a local checkout, " +
            "and there was no way over the network to give a trip its costs page at all.\n\n" +
            "**`budget` is required.** A zero or missing total is refused here with a " +
            "`problems` entry, rather than written and read back as no budget at all — " +
            "`lib/costFormat.ts`'s `parseBudget` drops one silently for a page render, and a " +
            "door cannot repeat that (B263).\n\n" +
            "Same authority as writing a day: whoever may `POST` a day into this trip may " +
            "`PUT` its costs, trip-scoped tokens included — a budget is trip content, and the " +
            "people on a trip are the people who spent the money.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Costs" } },
            },
          },
          responses: {
            "200": { description: "Written. GET this same URL to read it back." },
            "400": {
              description:
                "Invalid costs (a `problems` list, same shape as a day's — field, what " +
                "arrived, what was expected), invalid JSON, or a field this endpoint does " +
                "not write.",
            },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": { description: "No such trip" },
          },
        },
        patch: {
          summary: "Amend part of costs.md without resending the whole thing",
          description:
            "Textual, like PATCH .../days/{slug} (B266): a field this omits, and the file's " +
            "own formatting — comments, key order, flow or block YAML style — are left " +
            "exactly as they were, because this may well be a file the owner wrote by hand.\n\n" +
            "`budget`, `costs` and `body` each replace their own block wholesale when sent. " +
            "`budget: null` clears the budget alone and leaves `costs` and `body` untouched; " +
            "`costs: []` clears the preparation-costs list the same way. Neither removes " +
            "`costs.md` itself — that is DELETE, below, and it is the only call that makes " +
            "the costs page disappear.\n\n" +
            "Same authority as writing a day: whoever may `POST` a day into this trip may " +
            "`PATCH` its costs, trip-scoped tokens included.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Costs" } },
            },
          },
          responses: {
            "200": { description: "Amended. `changed` lists the fields that were sent." },
            "400": {
              description:
                "Invalid costs, an empty body, or a field this endpoint does not write — " +
                "named in `unsupported_field` rather than silently dropped.",
            },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": {
              description:
                "No such trip, or this trip has no costs.md yet — PUT to this same URL to " +
                "create one first.",
            },
          },
        },
        delete: {
          summary: "Remove costs.md — not always how the costs page goes away",
          description:
            "Whole file, not just the `budget:` line: the costs page is presence-driven " +
            "(B293) and `hasCostsData` (B267, widened B328) is what decides it exists, by " +
            "asking whether `costs.md` is there **or** any day carries its own `costs:` " +
            "block — so removing the file takes the budget away but leaves the page " +
            "standing if a day still logs spend (B332). The response's `costsPageGone` " +
            "says whether the page actually went, rather than leaving that to be inferred.\n\n" +
            "Not idempotent in status: calling this on a trip with no costs.md answers 404, " +
            "since there was nothing here to remove.\n\n" +
            "Same authority as writing a day: whoever may write to this trip may remove its " +
            "budget, trip-scoped tokens included.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description:
                "Removed. `costsPageGone` says whether the trip's costs page is actually " +
                "gone — false if a day still carries its own `costs:` block.",
            },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": { description: "No such trip, or this trip has no costs.md" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/plan": {
        get: {
          summary: "A trip's intended route, as stored",
          description:
            "The whole of `plan.md` — the stops the map can plot, each marked `reached` once " +
            "a real day exists near it, and the trip's own prose about the route. `exists: " +
            "false` means there is no `plan.md` yet, which is not an error: it is the same " +
            "answer an empty drafts list gives.\n\n" +
            "**Authority is reader-shaped**: this is the same document a guest-approved " +
            "reader's browser already sees on the trip page and the map (not the costs " +
            "route's rule, which is writer-only). In practice the only credential this door " +
            "takes is a bearer token, and every one this server issues is already scoped to " +
            "write this trip or the whole journal — so whoever can authenticate here already " +
            "could write it too.\n\n" +
            "**`draftsIncluded` narrows further, on purpose.** A trip's future-dated drafts " +
            "are folded into the route as extra stops for the owner only, never for a " +
            "trip-scoped token — a reader must not learn where somebody is going next from a " +
            "day nobody has published. `draftsIncluded: false` on a non-owner's call is not a " +
            "bug; it is why `stops` may be shorter than what the owner's own browser shows.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The trip's plan.md, parsed, with each stop marked reached or not." },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": { description: "No such trip" },
          },
        },
        put: {
          summary: "Write the whole plan.md",
          description:
            "Creates or wholly replaces a trip's intended route and its own prose about it, " +
            "in one call — the write half of B909: before it, a plan could only be written by " +
            "hand, over SSH or with the `add-a-trip` skill on a local checkout.\n\n" +
            "Each stop needs a `location` and a real `lat`/`lng` — a `problems` entry names " +
            "any that do not. No tool in the helper's own registry calls this route: a " +
            "planner that turns a spoken destination into a route is anticipated but not yet " +
            "built (see the route's own module comment), so what is written here is a " +
            "person's own words about places they named, sent by whichever agent they are " +
            "using — never a model's invention of an itinerary nobody asked for.\n\n" +
            "Same authority as GET: whoever holds a bearer token for this trip or journal may " +
            "write its route.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Plan" } },
            },
          },
          responses: {
            "200": { description: "Written. GET this same URL to read it back." },
            "400": {
              description:
                "Invalid route (a `problems` list — field, what arrived, what was expected), " +
                "invalid JSON, or a field this endpoint does not write.",
            },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": { description: "No such trip" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/rates": {
        get: {
          summary: "A trip's frozen exchange rates, as stored",
          description:
            "The `rates:` table on this trip's `trip.md` — units of the journal's base " +
            "currency for one unit of each keyed currency, so `{\"THB\": 0.0245}` reads " +
            "\"1 THB = 0.0245\" of the base. A currency with no rate is simply absent; its " +
            "costs are reported as unconverted rather than guessed at.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The trip's rates table" },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal, or is scoped to a trip" },
            "404": { description: "No such trip" },
          },
        },
        patch: {
          summary: "Amend a trip's exchange rates after it was created — B352",
          description:
            "`createTrip` could only ever write `rates:` once, at the moment a trip is made " +
            "(B207); this is the door to fix or fill in a rate afterwards, for a hosted " +
            "instance where nobody has a shell to edit `trip.md` by hand.\n\n" +
            "**Merges, does not replace.** Naming one currency fills in or corrects that one " +
            "and leaves every other rate already on the trip untouched — send the one rate a " +
            "trip is missing, not the whole table. Costs already recorded in a currency you " +
            "just add convert the next time the costs page, or any total drawn from it, is " +
            "read.\n\n" +
            "**Owner only, like `rates` at creation** — a trip-scoped token is refused with " +
            "`out_of_scope`: a rate table is metadata about the trip, the same shelf " +
            "`visibility` and `people` sit on, and not content a traveller logs. That is " +
            "unlike the trip's budget, which anyone on the trip may write.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["rates"],
                  properties: {
                    rates: {
                      type: "object",
                      additionalProperties: { type: "number" },
                      description:
                        "Currency code to rate, e.g. {\"EUR\": 0.94} — units of the base " +
                        "currency for one unit of the keyed currency.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Merged and written. `rates` is the trip's full table after the merge." },
            "400": {
              description: "Invalid JSON, an empty or malformed rates object, or an unrecognisable currency code.",
            },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "The token belongs to a different journal, or is scoped to a trip rather than " +
                "the journal's owner (`out_of_scope`).",
            },
            "404": { description: "No such trip" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/visibility": {
        get: {
          summary: "Who may read this trip, as stored",
          description:
            "`visibility:` and `listed:` on this trip's `trip.md` — `private` (the people who " +
            "were there, and the owner), `public` (everyone) or `guest` (everyone the owner " +
            "has approved into the journal, and the people who were there), and whether the " +
            "trip is advertised in the sitemap, the feed and the trip switcher — plus " +
            "`teaser:`, whether a closed trip is named on the trips page without being " +
            "opened.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The trip's visibility, listed and teaser flags" },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal, or is scoped to a trip" },
            "404": { description: "No such trip" },
          },
        },
        patch: {
          summary: "Change who may read this trip after it was created — B396",
          description:
            "`createTrip` could only ever write `visibility:` once, at the moment a trip is " +
            "made (B207); this is the door to change it afterwards, for a hosted instance " +
            "where nobody has a shell to edit `trip.md` by hand — the contacts page's own " +
            "advice, \"set a trip's visibility to guest\", had nowhere else to send an owner.\n\n" +
            "**Send only what changes** — `visibility`, `listed`, `teaser`, or any of " +
            "them. An unrecognised " +
            "`visibility` is refused rather than written and read back as `private` later, " +
            "the same rule the file's own reader already follows. `listed: true` is refused " +
            "on a trip whose visibility does not already advertise it (B51) — only `public` " +
            "does, and `teaser: true` is refused on a public trip for the mirror reason: it " +
            "names a trip nobody may read, and a public trip is readable.\n\n" +
            "**Widening is said out loud.** Moving towards `public`, or from `private` to " +
            "`guest`, exposes every day already published on this trip to a wider audience " +
            "the instant this call returns; the response's `note` says so. Narrowing needs no " +
            "such warning: it can only take readers away.\n\n" +
            "**Owner only, like `visibility` at creation** — a trip-scoped token is refused " +
            "with `out_of_scope`: this is metadata about the trip, the same shelf `rates` and " +
            "`people` sit on, and deciding who else may read the whole journey is not the " +
            "authority writing a day into it grants.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    visibility: { type: "string", enum: VISIBILITY_ENUM },
                    listed: { type: "boolean" },
                    teaser: {
                      type: "boolean",
                      description:
                        "Whether a *closed* trip says that it exists: a `guest` or `private` trip carrying " +
                "this gets a locked card on `/<user>/trips` with its title, its dates and " +
                "nothing else — no cover, no counts, no route — linking to its own sign-in " +
                "gate. Refused with `invalid_teaser` on a public trip, where `listed` is the " +
                "key that decides. Never a reading right: who may open the trip is " +
                "`visibility` alone.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Written and read back. `note` says whether this widened who may read the trip.",
            },
            "400": {
              description:
                "Invalid JSON, no field named, an unrecognised visibility, a listed: true " +
                "this trip's visibility does not advertise, or a teaser: true on a public " +
                "trip.",
            },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "The token belongs to a different journal, or is scoped to a trip rather than " +
                "the journal's owner (`out_of_scope`).",
            },
            "404": { description: "No such trip" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/tracks": {
        get: {
          summary: "What this trip keeps track of, and therefore asks every day for",
          description:
            "`costs`, `coordinates` and `photos`, each true unless the owner has turned it " +
            "off. A day that says nothing about a tracked row is refused with 422 " +
            "`incomplete_day` — send the thing, or say in the same call that the day does " +
            "not have it. Read this before writing days rather than after the first refusal.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The rows, and what each one asks for" },
            "401": { description: "Missing or invalid token" },
            "404": { description: "No such trip, or none this token may read" },
          },
        },
        patch: {
          summary: "Turn a row off, or back on. Owner only",
          description:
            'Send {"tracks": {"costs": false}} — only the rows you name change. Turning a ' +
            "row off is the owner deciding this journey is not keeping that; it is not a way " +
            "to quieten one awkward write, which is what the per-day decline is for. Nothing " +
            "already written changes either way.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["tracks"],
                  properties: {
                    tracks: {
                      type: "object",
                      properties: {
                        costs: { type: "boolean" },
                        coordinates: { type: "boolean" },
                        photos: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "What the trip asks for now, and what changed" },
            "403": { description: "A trip-scoped token cannot lower the bar it is measured against" },
          },
        },
      },
      "/api/v1/{user}/sync/manifest": {
        get: {
          summary: "Every file in this journal, with a hash — the call a sync makes first",
          description:
            "What the journal's folder holds, file by file: a POSIX-slashed path relative to " +
            "`content/<user>/`, a size, and a 32-character SHA-256 prefix of the whole file. " +
            "Diff it against your own folder and you know exactly what moved, in either " +
            "direction — which is the thing that was impossible before B1495, when content " +
            "only ever flowed up and getting the newest version back down meant unzipping a " +
            "whole export over the top of whatever was local.\n\n" +
            "**In it:** `config.json`, and everything under `trips/<id>/` — `trip.md`, " +
            "`entries/*.md` **including drafts**, `costs.md`, `plan.md`, and `media/` as the " +
            "derivative files the site itself serves. `inbox/**` is in it too, sidecars and " +
            "all. Drafts are included on purpose: the folder is a faithful mirror or it is " +
            "not a backup.\n\n" +
            "**Not in it,** and each for its own reason: `gps/`, the owner's position " +
            "history, which no route returns and no manifest names; generated output " +
            "(`postcards/`, `photobooks/`, `.ingest.json`, and `track.json`, which this " +
            "server derives — do not send it back); `originals/`, the full-resolution " +
            "photographs a photobook prints from, which are an order of magnitude larger " +
            "than what the site serves and are backed up from the filesystem rather than " +
            "through a browser; and dotfiles at any depth. The `omitted.originals` block " +
            "counts what was left behind, so a client can say so rather than present a " +
            "partial copy as a complete one.\n\n" +
            "Fetch a file with `GET /api/v1/{user}/sync/file/{path}`. To send changes **up**, " +
            "use the ordinary typed routes — `PATCH .../days/{slug}`, `PATCH .../trips/{trip}` " +
            "and the rest. There is deliberately no file `PUT`: writing a day as raw bytes " +
            "would go around every check `POST .../days` runs, including the one that refuses " +
            "a caller supplying its own weather reading.\n\n" +
            "**Owner only.** A trip-scoped token is refused, because this lists every private " +
            "trip and every unpublished draft in the journal — the same gate, and the same " +
            "404-rather-than-403 refusal, that `/{user}/export.zip` uses.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description:
                "`{user, files: [{path, size, hash}], bytes, omitted, next}`, files sorted by path",
            },
            "401": { description: "No live token — authenticate" },
            "404": {
              description:
                "No such journal, or a token that is not the owner's — including a " +
                "trip-scoped one. The two answer alike, so this cannot be used to ask which " +
                "journals exist.",
            },
          },
        },
      },
      "/api/v1/{user}/sync/file/{path}": {
        get: {
          summary: "One file of the journal's folder, by the path the manifest named",
          description:
            "The bytes of one file, unchanged. `path` is the manifest's own `path` for it, " +
            "slashes and all (`trips/alps-2024/media/over-the-susten/01.jpg`). The response " +
            "carries the file's own content type.\n\n" +
            "**Only what the manifest lists is fetchable.** The same predicate decides both, " +
            "so a path the listing left out is refused here whether it was guessed or " +
            "inferred — `gps/` most of all, but equally `originals/`, `track.json` and any " +
            "dotfile. A path climbing out of the journal is refused rather than resolved.\n\n" +
            "**Read-only, and there is no `PUT` beside it.** Send changes up through the " +
            "typed routes; see the manifest call for why that asymmetry is deliberate.\n\n" +
            "**Owner only**, the same gate as the manifest.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            {
              name: "path",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The manifest's `path` for the file, relative to `content/<user>/`.",
            },
          ],
          responses: {
            "200": { description: "The file's bytes, with its own content type" },
            "401": { description: "No live token — authenticate" },
            "404": {
              description:
                "No such journal; a token that is not the owner's, including a trip-scoped " +
                "one; no such file; or a path this sync does not carry (`gps/`, " +
                "`originals/`, `track.json`, a dotfile, or one climbing out of the journal). " +
                "All answer alike.",
            },
          },
        },
      },
      "/api/v1/{user}/inbox": {
        get: {
          summary: "Everything staged, and what was said about it",
          description:
            "The journal's inbox: files that have been uploaded and belong to no day yet. " +
            "Grouped by kind — " +
            `${INBOX_KINDS.join(", ")}. \`location\` is a WhatsApp location pin waiting to be ` +
            "put on a day; `contact` is a shared WhatsApp contact card, staged as a vCard, " +
            "waiting to be invited as a guest or discarded.\n\n" +
            "Each file carries its id, the name it arrived under, its size, and what is known " +
            "about it (`description`, `caption`, `lat`, `lon`, `takenAt`, `tags`, `location`, " +
            "`country`, `countryCode`; absent means nothing is known). **Not all of it is what " +
            "the uploader said.** `measuredFrom: \"exif\"` marks `lat`/`lon`/`takenAt` as read " +
            "from a photograph's own embedded metadata rather than typed by anyone; `location`/" +
            "`country`/`countryCode` on a `location`-kind item come from a reverse-geocode " +
            "lookup, never from a person. Everything else is exactly what somebody said, never " +
            "a guess.\n\n" +
            "Make this call before writing days for a trip somebody has just come back from: " +
            "the pictures are usually here already. Filing one into a day is " +
            "`POST /api/v1/{user}/trips/{trip}/media` with `inbox`.\n\n" +
            "**A trip-scoped token is refused** — the bucket belongs to the journal, and " +
            "showing it would show files staged for trips you are not on.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "What is staged, by kind" },
            "401": { description: "No live token — authenticate" },
            "403": { description: "A different journal's token, or one scoped to a trip" },
          },
        },
        post: {
          summary: "Stage files that belong to no day yet",
          description:
            "The one upload door that does **not** ask which day a file is for. That is what " +
            "it is for: a camera emptied on the evening it happened, when the days that will " +
            "hold the pictures are still unwritten.\n\n" +
            "multipart/form-data. `files` may repeat; `meta` and `kind` may repeat alongside " +
            "it, one per file and in the same order. Everything on `meta` is optional and " +
            "every field of it is **what you were told** — never what you concluded from " +
            "looking at the file. A file with no description is normal; an invented one is " +
            "not recoverable.\n\n" +
            "**Duplicates are free.** A file is named by a hash of its own bytes, so the same " +
            "file sent twice is stored once and the second call answers with the first one's " +
            "id and `duplicate: true`. Two different files sharing a name both survive.\n\n" +
            "Counts against the journal's storage ceiling like everything else — see " +
            "`storage` in `GET /api/v1/{user}/status`.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["files"],
                  properties: {
                    files: {
                      type: "array",
                      items: { type: "string", format: "binary" },
                      description:
                        `Repeatable. Images and video as the media route takes them, plus ` +
                        `${[...INBOX_FILE_EXTENSIONS].join(", ")} for the documents nothing ` +
                        "reads yet.",
                    },
                    kind: {
                      type: "array",
                      items: { type: "string", enum: [...INBOX_KINDS] },
                      description:
                        "Optional, one per file and in the same order. Which folder it goes " +
                        "in. Left out, it is worked out from the extension: a picture or a " +
                        "clip is `media`, a document is `files`. Say `photobook` or " +
                        "`postcards` for artwork meant for a printed thing.",
                    },
                    meta: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Optional, one JSON object per file and in the same order: " +
                        "`description`, `caption`, `lat`, `lon`, `takenAt`, `tags`. All " +
                        "optional. Only what somebody told you.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Staged. Each item carries its id and its sidecar" },
            "400": { description: "A file was refused — kind, size, or no room left" },
            "401": { description: "No live token — authenticate" },
            "403": { description: "A different journal's token, or one scoped to a trip" },
            "413": { description: "The whole request is too big to buffer" },
          },
        },
      },
      "/api/v1/{user}/inbox/{id}": {
        delete: {
          summary: "Take one staged file back out",
          description:
            "No confirmation code: nothing staged has ever been on the site and nobody has " +
            "read it. A photograph already filed into a day is a different route, and that " +
            "one does ask. The file and its sidecar go together.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Gone" },
            "403": { description: "A different journal's token, or one scoped to a trip" },
            "404": { description: "Nothing staged under that id" },
          },
        },
      },
      "/api/v1/{user}/import": {
        get: {
          summary: "What can be imported, and in which formats",
          description:
            "The kinds of data this instance can read, and who wrote each format it " +
            `understands: ${IMPORT_KINDS.join(", ")}. A kind is what the data *is* — a ` +
            "location history, a bank statement — and a format is who wrote it.\n\n" +
            "This is the only `GET` in the import feature, and it describes the door rather " +
            "than what is behind it. **Nothing anywhere hands back a position.** A location " +
            "history is every address somebody sleeps at and every place they work; what a " +
            "reader ever sees is the derived line for one trip, drawn behind that trip's own " +
            "gate.\n\n" +
            "**`gps` ends differently from the other two.** It is stored as it is read — a " +
            "coordinate is a measurement and there is nothing to decide about it. `costs` " +
            "and `contacts` write nothing at all: a statement covers the trip and the " +
            "fortnight either side of it, and a vCard is somebody's whole address book, and " +
            "in both cases what a row is *for* is an editorial decision. They report, a " +
            "person agrees, and `POST /api/v1/{user}/trips/{trip}/costs/import` or " +
            "`POST /api/v1/{user}/contacts/import` writes.\n\n" +
            "**A trip-scoped token is refused** on all of these — the history belongs to the " +
            "journal, not to the trip you came on.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The kinds, their formats, and the size limit" },
            "401": { description: "No live token — authenticate" },
            "403": { description: "A different journal's token, or one scoped to a trip" },
          },
        },
        post: {
          summary: "Read an export into the journal's own data",
          description:
            "Takes a file somebody exported from somewhere else — Google Maps Timeline, a " +
            "Takeout `Records.json`, a GPX track, plain JSON Lines from a tool of your own, " +
            "a Revolut statement, or a phone's own vCard — and reads it into the journal.\n\n" +
            "**Say the `kind`.** With more than one, an absent one is refused rather than " +
            "guessed at: reading a bank statement as positions, or a location history as " +
            "money, is not a mistake to make quietly.\n\n" +
            "**Three ways to hand over the bytes.** `inbox` names a file already staged with " +
            "`POST /api/v1/{user}/inbox` and is the normal path for a real export; " +
            "multipart `file` is a one-shot; `text` is for a handful of lines pasted in. The " +
            "import leaves the staged file where it is — deleting it is " +
            "`DELETE /api/v1/{user}/inbox/{id}`, and worth doing, because it is the " +
            "unthinned original.\n\n" +
            "**Leave `format` out and the file is recognised from its contents.** Name one " +
            "only when detection gets it wrong, or when you wrote the importer.\n\n" +
            "**Positions are thinned on the way in** — one kept per five minutes or 250 " +
            "metres, whichever comes first — so importing the same export twice changes " +
            "nothing, and importing overlapping exports does not double anything.\n\n" +
            "Nothing is drawn by this call. `POST /api/v1/{user}/trips/{trip}/track` is what " +
            "turns what is now stored into one trip's line.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    kind: {
                      type: "string",
                      enum: [...IMPORT_KINDS],
                      description:
                        "What the data is. **Required**: with two kinds, an absent one is " +
                        "refused rather than guessed at.",
                    },
                    format: {
                      type: "string",
                      enum: [...GPS_FORMATS, ...COSTS_FORMATS, ...CONTACTS_FORMATS],
                      description:
                        "Who wrote the file, within its kind. Left out, it is detected from " +
                        "the contents.",
                    },
                    from: {
                      type: "string",
                      description:
                        "`costs` only: ignore rows before this ISO date. Usually the trip's " +
                        "start — a statement holds the fortnight either side of it too.",
                    },
                    to: {
                      type: "string",
                      description: "`costs` only: ignore rows after this ISO date.",
                    },
                    inbox: {
                      type: "string",
                      description:
                        "The id of a file already staged in the inbox. The normal path.",
                    },
                    text: {
                      type: "string",
                      description:
                        "A small export inline, instead of `inbox`. JSON Lines of " +
                        "`[t, lat, lon]` is the format for anything you generated yourself.",
                    },
                    dryRun: {
                      type: "boolean",
                      description:
                        "`gps` only: parse, check and report without writing anything. This " +
                        "is how you test an importer you wrote — it runs the same contract " +
                        "check the format's own `schema.ts` exports. A `costs` or `contacts` " +
                        "import never writes in the first place, so the flag changes nothing " +
                        "there; it is accepted, and the answer says so rather than leaving " +
                        "you to wonder whether the read happened.",
                    },
                  },
                },
              },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    kind: { type: "string", enum: [...IMPORT_KINDS] },
                    format: { type: "string", enum: [...GPS_FORMATS, ...COSTS_FORMATS, ...CONTACTS_FORMATS] },
                    dryRun: { type: "string", enum: ["true", "false"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Read. Says which format, whether it was detected, how many rows and over " +
                "what span, and — unless `dryRun` — how many the store holds now",
            },
            "400": {
              description:
                "`unknown_kind`, `unknown_format`, `unreadable`, `contract` (what came out " +
                "does not hold up — the problems are listed in words), `no_file`, or " +
                "`storage_full`",
            },
            "401": { description: "No live token — authenticate" },
            "403": { description: "A different journal's token, or one scoped to a trip" },
            "404": { description: "No such journal, or no such file in the inbox" },
            "413": { description: "The whole request is too big to buffer" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/costs/import": {
        post: {
          summary: "Put agreed statement rows onto the days they happened",
          description:
            "The second half of a `costs` import. `POST /api/v1/{user}/import` read the " +
            "statement and wrote nothing; this takes back the rows a person has agreed and " +
            "records them as costs on the days.\n\n" +
            "**Two decisions happen in between, and neither is yours.** *Which rows* — a " +
            "statement covers the trip, the rent and the phone bill. *Which category* — a " +
            "statement says what was paid, never what it was for. Agree them against the " +
            "import's `merchants` list, which is sorted biggest first because one decision " +
            "about a merchant covers every payment to it. `other` is a real answer; a guess " +
            "dressed as a category is not.\n\n" +
            "**It adds, and never replaces.** Costs somebody wrote by hand stay. Sending the " +
            "same rows twice writes them twice — visible on the day and correctable there, " +
            "which is the honest behaviour for an append.\n\n" +
            "A date whose day has not been written yet is reported back in `orphaned` and " +
            "nothing is recorded for it. The cost is never moved to a neighbouring day.\n\n" +
            "Writable by anybody who may write the trip, trip-scoped tokens included: " +
            "nothing here reads the owner's statement or reaches outside this trip.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["rows"],
                  properties: {
                    rows: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["date", "label", "amount", "currency", "category"],
                        properties: {
                          date: { type: "string", description: "ISO date — which day it goes on" },
                          label: { type: "string", description: "What it is called on the day" },
                          amount: {
                            type: "number",
                            description:
                              "Positive: what it cost. A statement's minus sign belongs to " +
                              "the statement; a negative cost renders as a negative total.",
                          },
                          currency: { type: "string" },
                          category: { type: "string", enum: [...COST_CATEGORIES] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "What was written, per day, with how many existing costs were kept — and " +
                "`orphaned` for dates with no day",
            },
            "400": { description: "`invalid_costs` — every bad field of every row at once" },
            "401": { description: "No live token — authenticate" },
            "403": { description: "A token that may not write this trip" },
            "404": { description: "No such trip" },
          },
        },
      },
      "/api/v1/{user}/contacts/import": {
        post: {
          summary: "File the vCard rows a person agreed are actually contacts",
          description:
            "The second half of a `contacts` import. `POST /api/v1/{user}/import` (kind " +
            "`contacts`) read a vCard and wrote nothing; this takes back the entries a " +
            "person has agreed and files each as a `pending` request — the same row shape " +
            "and the same confirmation mail the public request form produces. Nothing is " +
            "pre-approved, and nobody is a reader, a postcard recipient or anything else " +
            "until the address itself confirms.\n\n" +
            "**One decision happens in between, and it is not yours.** A phone's own " +
            "address book is mostly people who have nothing to do with this journal; " +
            "*which rows are actually contacts* is a person's call, made against the " +
            "`people` the import reported.\n\n" +
            "A row with no `email` cannot be filed — `lib/contacts` keys every row on one, " +
            "the same reason a phone-only contact is shown but not importable.\n\n" +
            "**Owner only.** A trip-scoped token is refused: an address book belongs to " +
            "the whole journal, not to the days a trip covers.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["rows"],
                  properties: {
                    rows: {
                      type: "array",
                      maxItems: 50,
                      items: {
                        type: "object",
                        required: ["name", "email"],
                        properties: {
                          name: { type: "string" },
                          email: { type: "string" },
                          tel: {
                            type: "string",
                            description:
                              "Carried through from the card if it had one. Never a postal " +
                              "address — a vCard's own is not imported here.",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "`filed` and `invalid` counts, plus `results` naming the outcome per row: " +
                "`created`, `updated`, `ignored` (a blocked address) or `invalid`",
            },
            "400": { description: "No `rows`, an empty array, or more than 50 of them" },
            "401": { description: "No live token — authenticate" },
            "403": { description: "A token scoped to a trip rather than the whole journal" },
            "404": { description: "No such journal, or contacts are off on it" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/track": {
        post: {
          summary: "Draw this trip's line from the imported history",
          description:
            "Derives the ground actually covered on this trip and writes it into the trip, " +
            "where the map draws it faintly under the day markers.\n\n" +
            "Four things happen, and three are about what does *not* come out: the line is " +
            "**clipped to the trip's dates** (everything outside is the rest of somebody's " +
            "life), the owner's **private zones are cut out** and the line broken there, a " +
            "**gap of more than two hours is left as a gap** rather than joined — a flight " +
            "is a hole in the data, not a straight line across a continent — and the rest is " +
            "simplified to a few thousand points.\n\n" +
            "Answers with counts and never with a coordinate. Safe to run again whenever " +
            "more history has been imported; it rewrites one file. A trip with nothing " +
            "stored for its dates writes nothing and leaves any existing line alone.\n\n" +
            "**Owner only, and a trip-scoped token is refused even for its own trip**: " +
            "deriving reads the owner's whole history across those dates.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description:
                "Segments, points and how many private zones were applied. `written: false` " +
                "means nothing was stored for these dates",
            },
            "401": { description: "No live token — authenticate" },
            "403": { description: "A different journal's token, or one scoped to a trip" },
            "404": { description: "No such trip" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/media": {
        post: {
          summary: "Upload photographs or video to a day, and add them to it",
          description:
            "**The files are put into the day's entry for you.** There is nothing to " +
            "paste, and it does not matter whether you write the day before or after " +
            "sending its pictures — only that the day exists.\n\n" +
            "Two ways in. multipart/form-data carries the bytes: `day` is the slug of a " +
            "day in this trip, and `files` may repeat. application/json carries `urls` " +
            "for this server to fetch — https only, public hosts only, refused after a " +
            "redirect to a private address.\n\n" +
            "Two files are kept for each one sent: a resized copy for the browser and the " +
            "original for print. **The file you send is kept, untouched, as the print " +
            "master** — a photobook is made from it, never from the resized copy — so send " +
            "the largest file you have, not the size the site happens to display. A full-page " +
            "plate at 300 dpi wants roughly 2500×3500 px, " +
            "well past the 2000px the served copy is capped to; `/api/health`'s `media." +
            "imageMaxEdge` is the ceiling this server allows, and it is a target to approach, " +
            "not a size to stay comfortably under. For a URL upload the original is whatever " +
            "the remote host served, so a 2000px source is what a photobook will be printed " +
            "from, and there is no way to get the pixels back later. The served copy is " +
            "always a JPEG, whatever was sent, which is why the reply names it `01.jpg`; the " +
            "original is untouched and `kept` reports its bytes.\n\n" +
            "**There is no way to improve a photograph already on a day by re-sending a " +
            "larger version of it.** This route's own duplicate check compares bytes, not " +
            "names, so a bigger export of the same picture is not recognised as \"the same " +
            "photograph, better\" — it is simply not a duplicate, and lands as a second, " +
            "separate item beside the first rather than replacing it. To swap in a better " +
            "file, remove the original with `DELETE .../media` first, then upload the " +
            "replacement — there is no in-place upgrade. Cheaper to send the largest file " +
            "from the start than to discover this after a trip is already published.\n\n" +
            "**Nothing is read out of the files.** No EXIF is opened, so a photograph " +
            "carrying GPS and a DateTimeOriginal adds no `lat`, `lng`, `location`, " +
            "`country` or `time` to the day. Send those on the day itself — POST or PATCH " +
            "`/days` take them. The local `npm run ingest` CLI is the one thing here that " +
            "reads a card's EXIF, and it runs where the journal lives.\n\n" +
            `**The whole request may carry ${(REQUEST_MAX_BYTES / 1024 / 1024).toFixed(0)} MB**, which is a different limit from ` +
            "the per-file one and is the one a batch of phone originals meets first. Over " +
            "it the answer is 413 `body_too_large`, naming the cap and what arrived; " +
            "nothing is written, and a day may be filled by as many calls as you like.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["day", "files"],
                  properties: {
                    day: {
                      type: "string",
                      description: "A day that already exists in this trip. Write the day first.",
                    },
                    files: {
                      type: "array",
                      items: { type: "string", format: "binary" },
                      description:
                        `Repeatable. Images: ${IMAGE_FORMATS.join(", ")} — no other format ` +
                        `is taken, and note that .jpg and .jpeg are the same thing here. ` +
                        `Video: ${VIDEO_FORMATS.join(", ")}. At most ` +
                        `${IMAGE_MAX_BYTES / 1024 / 1024} MB and ${IMAGE_MAX_EDGE} px on the ` +
                        `long edge for a picture, ${VIDEO_MAX_BYTES / 1024 / 1024} MB and ` +
                        `${VIDEO_MAX_SECONDS} seconds for a clip — though about ` +
                        `${VIDEO_SHORT_SECONDS}s is the clip a reader watches, and a longer ` +
                        `one is taken whole and mentioned in \`advice\` rather than cut — ` +
                        `${MAX_ITEMS_PER_DAY} items ` +
                        `on one day, and ${REQUEST_MAX_BYTES / 1024 / 1024} MB in one ` +
                        "request — which is the limit a batch of phone originals meets " +
                        "first, so send them in batches rather than all at once. Send the " +
                        "largest you have: the original is what a photobook is printed from " +
                        "and there is no way to get the pixels back later.",
                    },
                    captions: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Optional, one per file and in the same order — `captions` may repeat " +
                        "like `files`. Fewer captions than files is fine; more is refused " +
                        "rather than misaligned, since a caption on the wrong photograph is " +
                        "worse than none. Write what you were told about the picture, never " +
                        "what it looks like to you.",
                    },
                    visibility: {
                      type: "array",
                      items: { type: "string", enum: [...PHOTO_VISIBILITIES] },
                      description:
                        "Optional, one per file and in the same order — same alignment rule " +
                        "as `captions`, and an empty value for a picture nobody is holding " +
                        "back. `guest` shows it to everybody the owner has let into the " +
                        "journal and to the people who were on the trip; `private` to the " +
                        "people who were there, and the owner. It narrows what the trip's " +
                        "own visibility already allows and can never widen it, so there is " +
                        "no `public`. Only ever what the owner asked for — a picture nobody " +
                        "said anything about is not held back on a hunch.",
                    },
                  },
                },
              },
              "application/json": {
                schema: {
                  type: "object",
                  required: ["day"],
                  properties: {
                    day: { type: "string" },
                    urls: {
                      type: "array",
                      items: { type: "string", format: "uri" },
                      description:
                        "https URLs on public hosts, to photographs or to clips — the same " +
                        "formats and the same per-file ceilings as the multipart door, " +
                        "and a `content-type` that is neither an image nor a video is " +
                        "refused. All or nothing: if any is refused, " +
                        "nothing is written and the reply names which and why. One of " +
                        "`urls` or `inbox` is required.",
                    },
                    inbox: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Ids from `GET /api/v1/{user}/inbox` — files already staged in this " +
                        "journal, which is how photographs get in before the days that will " +
                        "hold them exist. They are **moved**: the file goes into the day and " +
                        "leaves the inbox, so a written day owns its pictures. A caption on " +
                        "the staged file is used unless `captions` gives one here. An id " +
                        "that names nothing staged, or names something that is not a " +
                        "photograph, refuses the whole call and writes nothing.",
                    },
                    captions: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Optional, one per URL and in the same order. Same rules as the " +
                        "multipart door.",
                    },
                    visibility: {
                      type: "array",
                      items: { type: "string", enum: [...PHOTO_VISIBILITIES] },
                      description:
                        "Optional, one per URL and in the same order. Same rules as the " +
                        "multipart door.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Written and added to the day. `items` is the resized copy the site serves, " +
                "and its width/height are that copy's. `kept` is the original stored " +
                "untouched for print, with the dimensions you sent — the two differ on " +
                "purpose, and `kept` is how you confirm the full-resolution file survived " +
                "rather than taking it on trust — a clip is in `kept` like a photograph, and " +
                "its dimensions are absent because for a video they describe the " +
                "transcode, which `items` already carries. `advice` is present only when " +
                "there is something worth saying about a batch that succeeded, today that " +
                "a clip is long, or that a photograph looks like one this day already " +
                "has — a likeness is stored rather than dropped, and the note names the " +
                "`src` it resembles, because a duplicate tile is cheaper to fix than a " +
                "picture discarded in silence. `skipped` is narrower and is the only " +
                "thing that discards anything: photographs byte-for-byte identical to one " +
                "this day already holds, so sending the same batch twice adds nothing the " +
                "second time. Each entry names the file you sent and the `src` of the " +
                "picture it matched, so fewer `items` than files is not a loss. Clips are " +
                "not compared this way and a resent clip lands twice. " +
                "`attached` is false only if the entry has " +
                "no frontmatter to write into, in which case the files are still on disk " +
                "and `items` is what to add by hand. `note` says plainly when the day is " +
                "already published, so anyone reading it can now see the addition.",
            },
            "400": { description: "A file, a URL, or the day was rejected — the response says which and why" },
            "413": {
              description:
                "Over a size limit this instance sets — `body_too_large` when the request " +
                "itself is too big to buffer, which is the limit a batch meets first",
            },
          },
        },
        delete: {
          summary: "Take a photograph off a day, for good",
          description:
            "This route could put photographs on and never take one off, so the only " +
            "remedy for a duplicate or a wrong upload was a shell on the server — B605. " +
            "`src` — one or more — has to be exactly what `GET .../days/<slug>` handed back " +
            "for this day; a name the day does not carry refuses the whole call rather than " +
            "removing the rest and leaving you to notice which one silently did not land.\n\n" +
            "**The files are actually deleted**: the derivative, the poster if it was a clip, " +
            "and the kept original — not merely detached from the day. A photobook or " +
            "postcard order that already named one of these files is untouched; both resolve " +
            "the photograph live, at send or print time, so deleting one a *pending* order " +
            "names will make that order fail the same way it would if you had deleted the " +
            "file by hand. A completed order already has its copy at the printer and is not " +
            "affected either way.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["day", "src"],
                  properties: {
                    day: {
                      type: "string",
                      description: "The day these photographs are on.",
                    },
                    src: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "One or more, exactly as GET .../days/<slug> hands them back in " +
                        "`gallery`. Every one has to already be on this day, or nothing is " +
                        "removed.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Removed. `removed` lists the `src` of every photograph actually deleted, " +
                "and `note` says plainly when the day is already published, so anyone reading " +
                "it can now see the removal.",
            },
            "400": {
              description:
                "No `src` at all, or one naming a photograph this day does not have — the " +
                "response says which",
            },
            "404": { description: "No such day in this trip" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/media/duplicates": {
        get: {
          summary: "Photographs this trip holds more than once",
          description:
            "**The same picture twice, across every day of the trip.** Uploading says so " +
            "at the time — `advice` on POST .../media names the photograph a new one " +
            "resembles — and stores the second copy anyway, because a resemblance is a " +
            "guess and a dropped photograph cannot be got back. This is the question " +
            "afterwards, for a journal you did not upload.\n\n" +
            "`groups` holds one entry per photograph the trip has more than one copy of, " +
            "each listing `src`, `day`, `width`, `height` and `bytes`, largest first. The " +
            "largest is usually the one to keep — a full-size camera file beside the same " +
            "shot as it came back off a messaging app — but this endpoint does not decide " +
            "that and deletes nothing. Ask the owner which copy they want, then send the " +
            "other to DELETE .../media.\n\n" +
            "It compares what the browser is served, so what it says agrees with the advice " +
            "an upload gave. Video is left out — a poster frame is not the clip. A " +
            "resemblance is still a guess: two frames of one burst are different " +
            "photographs and can appear here.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description:
                "`groups` — empty when no photograph on this trip looks like another one " +
                "on it. Nothing has been changed either way.",
            },
            "401": { description: "No token, or one this journal does not know" },
            "404": {
              description:
                "No such trip — and the same answer a trip-scoped token gets for a trip it " +
                "does not name, so a probe cannot tell the two apart",
            },
          },
        },
      },
      "/api/auth/handover": {
        post: {
          summary: "Spend a handover credential for your own 7-day token",
          description:
            "The first call an agent makes when the owner pasted a prompt instead of " +
            "reading out a code. Send the handover credential as `Authorization: Bearer`. " +
            "It lasts 20 minutes, is spent by succeeding here, and is refused on every " +
            "other route. A 401 means expired or already used — ask the person for a fresh " +
            "one rather than retrying. The answer carries the 7-day token and the status " +
            "URL to read next.",
          responses: {
            "200": { description: "A 7-day agent token" },
            "401": { description: "No credential, or one that is expired, spent or not a handover" },
            "404": { description: "This server has authentication off" },
          },
        },
      },
      "/api/v1/{user}/handover": {
        post: {
          summary: "Issue a handover credential (owner only)",
          description:
            "What the owner's own access page calls so it can print a pasteable prompt. " +
            "Owner only, cookie or bearer. The credential it answers with lasts 20 minutes " +
            "and can only be exchanged at POST /api/auth/handover — never used to read or " +
            "write. An agent has no reason to call this; it is here so the contract is " +
            "complete.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "A 20-minute handover credential" },
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such journal, or sign-in is off for it" },
          },
        },
      },
      /**
       * The rest of the bearer-token surface — added in B540, because every
       * one of these was reachable, documented nowhere, and therefore
       * invisible to the only reader this document has. Two of them,
       * `travellers/presets` and `travellers/preview`, are named in AGENTS.md
       * as doors an agent should use and were still absent here.
       */
      "/api/health": {
        get: {
          summary: "Is this server well, what can it do, and what will it accept",
          security: [],
          description:
            "Public and unauthenticated. Read it **before** you do anything expensive: " +
            "`capabilities` says which optional features are on and, when one is off, why " +
            "— so an agent can tell \"this server cannot send mail\" from \"this call was " +
            "wrong\". `media` says what an upload may be, which is the one limit worth " +
            "knowing before rather than after sending 60 MB of photographs. `status` is " +
            "`error` and the code 503 when the config is unusable or the content root " +
            "cannot be read **or written** — a root that lists fine but refuses a write " +
            "is unhealthy too (B1248), because an instance that cannot accept a single " +
            "new day is not `ok` merely because its existing ones still read. `backup` " +
            "reports `state` and `maxAgeHours` to anybody; the timestamps, the failure " +
            "text and the off-site posture answer only to an operator holding " +
            "`HEALTH_TOKEN` as `Authorization: Bearer <token>`, since none of that is a " +
            "fact a caller who cannot already act on it has a use for (B1045).",
          responses: {
            "200": {
              description: "Healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", enum: ["ok", "error"] },
                      version: { type: "string" },
                      weather: {
                        type: "object",
                        description:
                          "`reservedSources` — the source names only this server may " +
                          "claim on a day's `weatherData`, refused from any caller " +
                          "because they mean this server performed the lookup itself " +
                          "(B1580). Every other source is valid, so this is a deny " +
                          "list rather than an enum on the field. Read it before " +
                          "forwarding a journal's days: one whose weather this server " +
                          "fetched carries a reserved source in its own file, and " +
                          "sending it back is refused.",
                        properties: {
                          reservedSources: {
                            type: "array",
                            items: { type: "string", enum: [...RESERVED_SOURCES] },
                          },
                        },
                      },
                      backup: {
                        type: "object",
                        description:
                          "Whether the nightly backup is current. `state` — `ok`, " +
                          "`stale`, `failing` or `unknown` — and `maxAgeHours` are all " +
                          "an unauthenticated caller gets; `lastSuccessAt`, `ageHours`, " +
                          "`lastFailureAt`, `lastFailure` and `reason`, and the same on " +
                          "`secondary`, need `HEALTH_TOKEN`.",
                        properties: {
                          state: {
                            type: "string",
                            enum: ["ok", "stale", "failing", "unknown"],
                          },
                          maxAgeHours: { type: "number" },
                          secondary: {
                            type: "object",
                            properties: {
                              state: { type: "string", enum: ["ok", "stale", "unknown"] },
                              maxAgeHours: { type: "number" },
                            },
                          },
                        },
                      },
                      capabilities: {
                        type: "object",
                        description:
                          "One entry per capability. `{ enabled: false, reason }` says why " +
                          "an absent feature is absent.",
                        properties: Object.fromEntries(
                          FEATURE_NAMES.map((name) => [
                            name,
                            {
                              type: "object",
                              properties: {
                                enabled: { type: "boolean" },
                                reason: { type: "string" },
                              },
                            },
                          ]),
                        ),
                      },
                      media: {
                        type: "object",
                        description:
                          "What POST …/media will take. Read this rather than assuming: " +
                          "the formats are a closed list and `jpg` is not one of them.",
                        properties: {
                          imageFormats: {
                            type: "array",
                            items: { type: "string", enum: [...IMAGE_FORMATS] },
                          },
                          videoFormats: {
                            type: "array",
                            items: { type: "string", enum: [...VIDEO_FORMATS] },
                          },
                          imageMaxBytes: { type: "integer" },
                          imageMaxEdge: {
                            type: "integer",
                            description:
                              "A ceiling, not a target — the uploaded file is kept as the " +
                              "print master a photobook prints from, and a smaller web copy " +
                              "is derived from it automatically. Larger is better up to this " +
                              "edge, not merely tolerated: a full-page 300 dpi plate wants " +
                              "roughly 2500×3500 px, well past the 2000 px the site itself " +
                              "ever shows. Send the largest file you have.",
                          },
                          videoMaxBytes: { type: "integer" },
                          videoMaxSeconds: { type: "integer" },
                          itemsPerDay: { type: "integer" },
                          requestMaxBytes: { type: "integer" },
                          captionMaxChars: { type: "integer" },
                        },
                      },
                      photobook: {
                        type: "object",
                        description:
                          "How many printed photobook orders a journal keeps on disk before " +
                          "older ones lose their PDFs (B483). `null` means this instance keeps " +
                          "every book.",
                        properties: {
                          keepOrdersPerUser: { type: ["integer", "null"] },
                        },
                      },
                    },
                  },
                },
              },
            },
            "503": { description: "The config or the content root cannot be read" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/people": {
        get: {
          summary: "Who is on this trip",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }, { name: "trip", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The people block" },
            "403": { description: "Owner only" },
            "404": { description: "No such trip" },
          },
        },
        patch: {
          summary: "Replace who is on this trip (owner only)",
          description:
            "The whole list at once, not a merge: send everyone who is on the trip, " +
            "including the ones already there. It is the byline **and** it is write " +
            "access — everyone named may write to the trip and may hold a token scoped to " +
            "it — so this is owner-only and a trip-scoped token cannot widen its own reach.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }, { name: "trip", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["people"],
                  properties: {
                    people: {
                      type: "array",
                      maxItems: 10,
                      items: {
                        type: "object",
                        required: ["name", "email"],
                        properties: { name: { type: "string" }, email: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "The list as it now stands" },
            "400": { description: "An entry is not usable" },
            "403": { description: "Owner only" },
            "404": { description: "No such trip" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/travellers": {
        get: {
          summary: "How this trip's party is drawn",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }, { name: "trip", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The travellers block" },
            "404": { description: "No such trip" },
          },
        },
        patch: {
          summary: "Replace how this trip's party is drawn",
          description:
            "The whole list at once. Cosmetic — it changes the walking figures and nothing " +
            "about who may read or write anything, which is why it is not owner-only the " +
            "way `people` is. Ask …/travellers/presets for the vocabulary first; an " +
            "unknown key inside a figure is refused rather than dropped.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }, { name: "trip", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["travellers"],
                  properties: {
                    travellers: {
                      type: "array",
                      maxItems: 10,
                      items: { $ref: "#/components/schemas/Traveller" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "The list as it now stands" },
            "400": { description: "A figure is not usable" },
            "404": { description: "No such trip" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/travellers/from-photo": {
        post: {
          summary: "Read a proposed party off a group photograph — B1517",
          description:
            "Forty questions about what a family of four looks like is worse than reading " +
            "two of their own photographs. This sends **one photograph already in this " +
            "journal** to a vision model and returns a proposed `travellers` party in the " +
            "same shape `PATCH …/travellers` writes — **and writes nothing itself.** " +
            "`figures` names, per figure, which fields the photograph actually answered and " +
            "which it did not (`unanswerable`) — a field the picture cannot show comes back " +
            "absent rather than guessed. `party` is the same figures alone, ready to send " +
            "straight to `PATCH …/travellers` once a person has agreed it looks like them. " +
            "`preview` is the SVG `GET …/travellers/preview` would draw for that party, so " +
            "there is something to show before anything is written.\n\n" +
            "Every value is one of the closed vocabulary `GET …/travellers/presets` " +
            "publishes — this is classification into a fixed list, not open-ended " +
            "generation — and there is **no `for`**: nothing here names a person or matches " +
            "a face to an address in `people:`.\n\n" +
            "The photograph has to already be this journal's own: `inbox` (an id from " +
            "`GET …/inbox`), `gallery` (a `src` already on **this** trip, exactly as a " +
            "day's gallery carries it), or multipart bytes under `photo`. There is no way " +
            "to hand it a URL — unlike `POST …/media`, which stores what it fetches, this " +
            "call does not store anything, so fetching an arbitrary address would be a way " +
            "to spend this journal's credits classifying a stranger's photograph. Nothing " +
            "sent here is kept: a fresh upload is resized in memory and never written to " +
            "disk.\n\n" +
            "Requires this journal's `helper` capability and its `photos` consent scope — " +
            "the same one `POST /api/helper/{user}/day/describe-photos` asks for, since " +
            "this is the same promise: a photograph of people is being sent to a model.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    inbox: { type: "string", description: "An id from GET …/inbox." },
                    gallery: {
                      type: "string",
                      description: "A src already on this trip, e.g. /media/{trip}/{day}/01.jpg.",
                    },
                    idempotency_key: { type: "string" },
                  },
                },
              },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["photo"],
                  properties: {
                    photo: { type: "string", format: "binary" },
                    idempotency_key: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "A proposed party, and nothing written",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok", "figures", "party", "preview", "spent", "provider"],
                    properties: {
                      ok: { type: "boolean" },
                      figures: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            position: {
                              type: "integer",
                              description: "Left to right in the photograph, 0-based.",
                            },
                            figure: { $ref: "#/components/schemas/Traveller" },
                            unanswerable: {
                              type: "array",
                              items: { type: "string" },
                              description: "Fields the photograph did not answer for this figure.",
                            },
                          },
                        },
                      },
                      party: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Traveller" },
                        description: "The figures alone, in the shape PATCH …/travellers takes.",
                      },
                      preview: { type: "string", description: "The party, as SVG markup." },
                      spent: { type: "number" },
                      provider: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": { description: "No usable photograph named, or it could not be read" },
            "402": { description: "Not enough credits" },
            "403": { description: "No write access to this trip, or `photos` consent not given" },
            "404": { description: "No such trip, or the helper capability is off" },
            "429": { description: "Too many calls in the last 15 minutes" },
            "502": { description: "The model call failed; the credit was refunded" },
          },
        },
      },
      "/api/v1/{user}/travellers/presets": {
        get: {
          summary: "The vocabulary the walking figures are described in",
          security: [],
          description:
            "Open, because it describes nothing about anybody: it is the list of hair, " +
            "skin, clothing and pack values a figure may use, and twelve worked starting " +
            "points. Read it before writing a `travellers` block rather than guessing at " +
            "value names.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The vocabulary and the presets" },
            "404": { description: "No such journal" },
          },
        },
      },
      "/api/v1/{user}/travellers/preview": {
        get: {
          summary: "A figure, drawn, so a person can see themselves before it is written",
          security: [],
          description:
            "Answers **SVG**, not JSON. Give it `figure` (one figure as JSON) or `party` " +
            "(a list), and optionally `size` in pixels. Nothing is stored. This is the " +
            "call that makes \"is this you?\" a question somebody can answer.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            {
              name: "figure",
              in: "query",
              schema: { type: "string" },
              description: "One figure, as JSON.",
            },
            {
              name: "party",
              in: "query",
              schema: { type: "string" },
              description: "A list of figures, as JSON. Wins over `figure`.",
            },
            { name: "size", in: "query", schema: { type: "integer", minimum: 24, maximum: 240 } },
          ],
          responses: {
            "200": { description: "image/svg+xml", content: { "image/svg+xml": {} } },
            "400": { description: "Nothing to draw, or the JSON did not parse" },
            "404": { description: "No such journal" },
          },
        },
      },
      "/api/v1/{user}/keys": {
        get: {
          summary:
            "The tokens and sessions that can write here — the owner sees every row, " +
            "anybody else only their own (B323)",
          description:
            "The owner gets one row per live credential in the journal, each with `email`. " +
            "Anybody else who has proved an address — a guest cookie, a year-long identity, " +
            "or a trip-scoped bearer token — gets only the rows issued to *that* address, " +
            "with no `email` field (the list is already implicitly theirs). There is no " +
            "parameter that widens this: the filter is the caller's own proven address, " +
            "never anything the request sends. Every row carries `scope`, in " +
            "`tripWriteScope`'s vocabulary, so a trip-bound key can be told apart from a " +
            "journal-wide one.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description:
                "One row per live credential this caller may see, with its kind, scope and " +
                "expiry",
            },
            "403": {
              description:
                "No proven address at all — no cookie, no identity, no bearer token for " +
                "this journal. For an address that owns the journal this also covers a " +
                "journal that does not exist, checked before the capability is (B340).",
            },
            "409": {
              description: "A proven address on this journal, but sign-in is off on it (`auth_disabled`)",
            },
          },
        },
        post: {
          summary:
            "Revoke one of them — the owner may revoke any row, anybody else only their own",
          description:
            "`{\"revoke\": \"<key id>\"}`, with an id from the GET above. It ends that " +
            "credential immediately — the way to answer \"an agent has a token I want back\". " +
            "An id that is not this journal's, or — for a non-owner — not this caller's own " +
            "row, answers the same `404` as an id that does not exist at all, so a guess " +
            "learns nothing.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["revoke"],
                  properties: { revoke: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Revoked" },
            "400": { description: "No key id sent" },
            "403": {
              description:
                "No proven address at all. For an address that owns the journal this also " +
                "covers a journal that does not exist, checked before the capability is " +
                "(B340).",
            },
            "404": {
              description:
                "No such key — either it does not exist, or (for a non-owner) it belongs to " +
                "somebody else's address",
            },
            "409": {
              description: "A proven address on this journal, but sign-in is off on it (`auth_disabled`)",
            },
          },
        },
      },
      "/api/v1/{user}/channels": {
        post: {
          summary: "Turn this journal's mail or WhatsApp on or off (owner only)",
          description:
            "The narrow door for the two channels a published day can go out on. The wider " +
            "one is PATCH …/config with `features`; this exists so a person can say \"stop " +
            "mailing me\" without a call that could change anything else.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["channel", "enabled"],
                  properties: {
                    channel: { type: "string", enum: ["mail", "whatsapp"] },
                    enabled: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "The channel as it now stands" },
            "400": { description: "Unknown channel, or `enabled` is not a boolean" },
            "403": { description: "Owner only" },
            "404": { description: "No such journal" },
            "429": { description: "Too many changes too quickly; `retryAfter` says when" },
          },
        },
      },
      "/api/v1/{user}/postcards/texts": {
        get: {
          summary: "What each day of a trip would say on the back of a card",
          description:
            "Per day, in the journal's languages, so a person can choose rather than have " +
            "an agent write one. `trip` is required.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The trip's days and their texts" },
            "403": { description: "Owner only" },
            "404": { description: "No such trip, or postcards are off on this server" },
          },
        },
      },
      "/api/v1/{user}/credits/purchase": {
        post: {
          summary: "Start a credit purchase and get a link to it (buys nothing)",
          description:
            "**Nothing is bought and nothing is granted.** It records a pending payment, mails " +
            "the owner, and answers with `paymentUrl` — an absolute link to the page where a " +
            "person chooses how to pay. The money and the credits happen there and at the " +
            "payment provider, deliberately, so that no token can spend anything. Hand the URL " +
            "over and report it as a request, never as a purchase.\n\n" +
            "`credits` is a whole number between `MIN_CREDITS` and `MAX_CREDITS` in steps of " +
            "`CREDIT_STEP` — " +
            `${MIN_CREDITS} to ${MAX_CREDITS} in ${CREDIT_STEP}s on this build. It replaced a ` +
            "`tier` field naming one of a fixed list (B854), so any amount in range can now be " +
            "asked for. **You name the amount, never the price:** the server computes what it " +
            "costs, and the response repeats `credits`, `priceRappen` and the `discount` that " +
            "was applied so you can quote what was started. Buying more at once costs less per " +
            "credit. Owner-only.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["credits"],
                  properties: {
                    credits: {
                      type: "integer",
                      minimum: MIN_CREDITS,
                      maximum: MAX_CREDITS,
                      multipleOf: CREDIT_STEP,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "A pending payment. `paymentUrl` is the absolute link to hand over; " +
                "`transactionId`, `credits`, `priceRappen` and `discount` say what was " +
                "started, and `mailedTo` is the owner address the same link went to.",
            },
            "400": {
              description:
                "Not an amount this server sells — out of range, not a whole number, or off " +
                "the step. Nothing was recorded and nothing was mailed.",
            },
            "403": { description: "Owner only" },
            "404": { description: "Credits are off on this server" },
          },
        },
      },
      "/api/v1/{user}/storage": {
        get: {
          summary: "Where this journal's space is going",
          description:
            "What is used, what is allowed, what is left, and a `breakdown` — one row per " +
            "trip, plus the inbox, the generated photobooks and postcards, and everything " +
            "else. The rows sum to `usedBytes` exactly.\n\n" +
            "`reclaimable` is what a cleanup would take back without touching a photograph: " +
            "generated PDFs and postcard sheets. Only the owner, in their own browser, can " +
            "run one — report the number and let them decide.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Usage, the breakdown, and what could be reclaimed" },
            "401": { description: "No live token — authenticate" },
            "403": { description: "This token belongs to a different journal" },
          },
        },
        post: {
          summary: `Buy this journal ${EXTRA_STORAGE_BYTES / 1024 ** 3} GB more room`,
          description:
            `Spends ${EXTRA_STORAGE_CREDITS} credits and raises this journal's storage ceiling ` +
            `by ${EXTRA_STORAGE_BYTES / 1024 ** 3} GB, immediately and for good — unlike ` +
            "`/credits/purchase`, this one really does charge. It cannot be undone, it does not " +
            "expire, and buying twice adds twice. No request body: there is one thing to buy and " +
            "one price.\n\n" +
            "**The owner's own browser session, and nothing else.** A bearer token is refused " +
            "here whatever it is scoped to, the same way ordering a photobook or posting a card " +
            "is: an agent that has just been refused an upload reports that the journal is full " +
            "and lets the owner decide whether to delete something or buy more room. " +
            "`GET /api/v1/{user}/status` is where the bytes held and the bytes allowed are read " +
            "back.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Bought. The new ceiling and what is used against it" },
            "402": { description: "The balance does not cover it — nothing was charged" },
            "403": { description: "Owner only, and never a bearer token — `not_for_agents`" },
            "404": { description: "Credits are off on this server" },
            "429": { description: "Too many purchases in a minute" },
          },
        },
      },
      "/api/v1/{user}/storage/cleanup": {
        get: {
          summary: "What a cleanup would remove (removes nothing)",
          description:
            "The plan behind the confirmation the owner reads: bytes and file counts, split " +
            "into photobooks, postcards and staged documents. `?staged=1` includes the " +
            "documents in `inbox/files/`. Nothing is deleted.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "staged", in: "query", required: false, schema: { type: "string", enum: ["1"] } },
          ],
          responses: {
            "200": { description: "What would go" },
            "403": { description: "Owner only, and never a bearer token — `not_for_agents`" },
            "404": { description: "No such journal" },
          },
        },
        post: {
          summary: "Delete generated photobooks and postcard sheets",
          description:
            "**Deletes files.** Generated photobook PDFs for orders that finished printing, " +
            "and dry-run postcard sheets. `?staged=1` also removes the documents staged in " +
            "`inbox/files/`; staged *photographs* are never in scope, and are removed one at " +
            "a time through `DELETE /api/v1/{user}/inbox/{id}` where a person is looking at " +
            "what they are removing.\n\n" +
            "Nothing else is touched: every photograph, day and trip stays, and a printed " +
            "book keeps its record, its price and its date — only the PDF goes, and it can " +
            "be built again from photographs that are still there. A book still building is " +
            "never touched.\n\n" +
            "**The owner's own browser session, and never a token**, for the same reason as " +
            "buying storage: an agent reports what is taking the space and does not decide " +
            "which of somebody's files to delete.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "staged", in: "query", required: false, schema: { type: "string", enum: ["1"] } },
          ],
          responses: {
            "200": { description: "Removed, with what was taken" },
            "403": { description: "Owner only, and never a bearer token — `not_for_agents`" },
            "404": { description: "No such journal" },
            "429": { description: "Too many cleanups in a minute" },
          },
        },
      },
      "/api/v1/{user}/payments/{id}/pay": {
        post: {
          summary: "Start paying a pending payment (grants nothing)",
          security: [],
          description:
            "Authenticated by the payment id in the path, which is an unguessable capability " +
            "reached from a link in the owner's own mail — not by a session and not by a " +
            "token in the body. It adds **no** credits on any path; `creditsAdded` is zero " +
            "and always will be.\n\n" +
            "What it does depends on whether this instance has a payment provider " +
            "configured (`/api/health` says, under `capabilities.credits.note`). With one, " +
            "the response carries `url` — a hosted checkout page to send the buyer to — and " +
            "`method` in the request is ignored, because the provider's own page is where " +
            "TWINT, a wallet or a card is chosen. Without one, it files a request and mails " +
            "the instance operator an approval link; `approver` is the address it went to, " +
            "and `method` is then required.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    method: {
                      type: "string",
                      enum: ["twint", "card"],
                      description:
                        "Required when no payment provider is configured; ignored when one is.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Recorded. `status` is `requested`; `creditsAdded` is `0`; `url` is present " +
                "when a provider is configured and the buyer should be sent there.",
            },
            "400": { description: "Unknown method, and no provider configured" },
            "404": { description: "No such payment" },
            "502": { description: "The payment provider could not be reached" },
          },
        },
      },
      "/api/v1/{user}/payments/{id}/approve": {
        post: {
          summary: "Approve a payment — the one call that grants credits",
          security: [],
          description:
            "Authenticated by the single-use `token` in the body. It is reached from a link " +
            "in the operator's mail rather than by anything an agent holds, and it is one of " +
            "only two HTTP paths that add credits to a journal — the other is the payment " +
            "provider's own signed webhook, which no client calls.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["token"],
                  properties: { token: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Approved, and the credits added" },
            "401": { description: "The token does not verify" },
            "404": { description: "No such payment" },
          },
        },
      },
      "/api/v1/{user}/status": {
        get: {
          summary: "Where you stand, in one call",
          description:
            "The first call to make, and the cheapest credential check there is: `401` " +
            "means go and get a code, `200` means you are in. Carries the journal, the " +
            "drafts waiting for a person to approve them — each with the call that " +
            "publishes it — the trips this token may write to, which capabilities are on " +
            "for this journal and why any is off, and a `next` saying what to do. " +
            "\n\n**`features` here is deliberately only the four an agent can act on** — " +
            "mail, push, postcards, photobook — plus `credits` where this server bills. " +
            "It is *not* the journal's whole capability list, and a name missing from it " +
            "is not a name that is off: `GET .../config` carries all of them and " +
            "`/api/health` says what this server can offer at all. The two fields share a " +
            "name and answer different questions, which has misled a reader of this " +
            "document before.\n\n" +
            "`scope` says whether you are holding the whole journal or one trip's slice; " +
            "do not report a slice as the journal's total.\n\n" +
            "**`credits`** is here when this server charges for sends (B366): `balance`, " +
            "and what each channel costs. Read it before publishing with `send_mail` or " +
            "`send_whatsapp` — a balance too small refuses the whole publish with 402 and " +
            "writes nothing. Absent means this server does not bill, not that the account " +
            "is empty; it is also absent for a trip-scoped token, which can neither " +
            "publish nor send.\n\n" +
            "**`storage`** is how full the journal is — `usedBytes`, `limitBytes`, " +
            "`remainingBytes` and `purchasedBytes`. Read it before uploading a batch: a " +
            "batch that would go past `limitBytes` is refused whole and nothing is " +
            "written. It counts every byte under the journal's folder, photobook PDFs " +
            "included, not only its photographs. A `limitBytes` of `null` means this " +
            "instance sets no ceiling — never that the answer is unknown. Present for a " +
            "trip-scoped token too, because the whole journal's ceiling is what refuses a " +
            "trip's photographs. `POST /api/v1/{user}/storage` is how the owner raises it.\n\n" +
            "**`inbox`** counts what is staged and belongs to no day yet (B663), with the " +
            "call that lists it. A non-zero count is the first thing to act on for a trip " +
            "somebody has just come back from — the photographs are already here. Absent for " +
            "a trip-scoped token, which the inbox route refuses.\n\n" +
            "**`malformed`** names a trip on disk with a `trip.md` too broken to parse (B83) — " +
            "the same list `GET .../trips` carries, so writing a trip and reading this back " +
            "cannot disagree about whether it took. `next` puts fixing one ahead of the draft " +
            "queue: a broken file is a thing you may have just caused and can fix yourself, " +
            "where the drafts are a person's decision. Present for an owner token only — a " +
            "trip-scoped token learns nothing about the rest of the journal, malformed or not " +
            "— and absent entirely when there is nothing broken.\n\n" +
            "**`suggestions`** is the moment nobody would otherwise notice — a published, " +
            "non-`test` day from the last week with a photograph, on a journal where " +
            "`postcards`, `credits` and `contacts` are all on, at least one contact has " +
            "asked for a postcard and given an address, and no order has been made for " +
            "that trip in the last week either. Each entry carries `kind: \"postcard\"`, " +
            "the `day` and `trip` it is about, a `reason` in words, and the `recipients` " +
            "it would go to (the same shape as `GET .../postcards/recipients`). Absent — " +
            "never an empty array — the moment any one of those conditions fails; the " +
            "same function backs the card on `/{user}/me`, so the two can never disagree. " +
            "`POST .../postcards` is the call that turns a suggestion into a proposal.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Status" },
            "401": { description: "No live token — authenticate" },
            "403": { description: "This token belongs to a different journal" },
          },
        },
      },
      "/api/v1/{user}/drafts": {
        get: {
          summary: "Everything written and not yet on the site",
          description:
            "Each draft carries where to publish it, and `test: true` if it is content " +
            "nobody lived — including a day that inherits the flag from its trip and says " +
            "nothing itself. Read that out with the rest: this is the list somebody is " +
            "looking at when they decide what goes on the site (B134). Absent means real.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description:
                "Every draft in the journal, each with the trip it belongs to and the " +
                "`publish` call that would put it on the site.",
            },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
          },
        },
      },
      "/api/v1/{user}/config": {
        get: {
          summary: "What this journal asks for, and what it says about itself",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description:
                "One boolean per capability under `features`, and the writable half of " +
                "config.json under `journal` — plus the two read-only fields a caller " +
                "needs and cannot otherwise learn: the `baseCurrency` a " +
                "`displayCurrencies` must contain, and the `media` block this journal " +
                "actually runs under, so a client syncing a folder up can tell whether " +
                "its local copy differs (B1504). `owner.email` is deliberately not here: " +
                "a token that reads a journal's config is not permission to collect its " +
                "owner's address.",
            },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
          },
        },
        patch: {
          summary: "Change a capability, or what this journal says about itself",
          description:
            "Send only what you are changing: `{\"features\": {\"contacts\": true}}`, or one " +
            "or more of `title`, `tagline`, `visibility`, `startLocation`, `units`, " +
            "`locales`, `defaultLocale`, `displayCurrencies`, `manualRates`, `ownerTel`, " +
            "`travellers`. " +
            "Before this " +
            "there was no endpoint, tool or page that wrote a journal's config at all, so it " +
            "was fixed at creation and only an operator with a shell could change it — which " +
            "left journals unable to invite anybody (B182) and a title typoed at signup " +
            "permanent (B220).\n\nCapabilities can only ask for what the server already " +
            "provides: the server's own config is a ceiling, and asking to exceed it is " +
            "refused with the reason rather than written and silently ignored. Switching a " +
            "capability *off* always works, except for the four the server decides alone: " +
            "`photobook` and `postcards` cost the operator money at a printer, and `logging` " +
            "and `credits` are the instance's own. All four are whatever the server says for " +
            "every journal on it, and either direction is refused with `capability_not_yours`.\n\n**Capabilities and the rest are two calls.** " +
            "A body naming `features` alongside another field is `400 mixed_change` and " +
            "writes nothing: each call rewrites config.json whole, reads it back, and " +
            "restores the previous bytes if it does not load, so a request doing that twice " +
            "is one that can succeed halfway.\n\nThree keys are never writable, each with " +
            "its own reason in the refusal. The `owner` block is not writable as a " +
            "whole, and `owner.email` in particular never is: it decides who can obtain a " +
            "token for this journal, so a token must not be able to move it. The telephone " +
            "number inside it is the exception, reached as the flat field `ownerTel`. `baseCurrency` is not a " +
            "display setting — a cost written without a `currency` IS a cost in the base " +
            "currency, so changing it re-reads every amount already recorded rather than " +
            "reconverting it. `media` is the operator's, and the server's limits are already " +
            "a ceiling over it. Owner only.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    features: {
                      type: "object",
                      // Named one by one rather than left as free-form booleans:
                      // "which capabilities are there" is exactly the question an
                      // agent cannot answer from prose, and a misspelled name was
                      // being refused with no list to correct it against. B540.
                      properties: Object.fromEntries(
                        FEATURE_NAMES.map((name) => [name, { type: "boolean" }]),
                      ),
                      additionalProperties: false,
                      description:
                        `Capability name to true or false — one of ${FEATURE_NAMES.join(", ")}. ` +
                        "Omitted ones are left alone, and an unknown name is refused rather " +
                        "than ignored. A journal can only ever switch on what this server " +
                        "already offers: /api/health says which those are, and asking for one " +
                        "it cannot do is refused. `logging` and `credits` are never a journal's " +
                        "own opt-in — they are the operator's alone, for the whole server — so " +
                        "the response echoes the server's own answer for those two regardless " +
                        "of what is sent here. Not combinable with the fields below — send it " +
                        "in a call of its own.",
                    },
                    title: { type: "string" },
                    tagline: {
                      type: "string",
                      description: "Empty string removes it rather than writing one.",
                    },
                    visibility: {
                      type: "string",
                      // `"private"` — the word before B306 — is still accepted
                      // and normalised to `guest` (normalizeJournalVisibility),
                      // but is not offered here.
                      enum: ["public", "guest"],
                      description: `Whether this server advertises the journal: ${VISIBILITY_MEANING}`,
                    },
                    startLocation: {
                      type: "string",
                      description: "Empty string removes it rather than writing one.",
                    },
                    units: { type: "string", enum: ["metric", "imperial"] },
                    locales: {
                      type: "array",
                      items: { type: "string", enum: [...MAINTAINED_LOCALES] },
                      description:
                        "Language codes, most preferred first. Must contain `defaultLocale`; " +
                        "a pair that disagrees is refused rather than written, because the " +
                        "resulting config would take the journal off the site entirely. " +
                        `Each entry must be one of ${LOCALE_LIST}, the same set creation ` +
                        "refuses outside of — B777: a field checked when a journal is made " +
                        "and unchecked when it is corrected is the same field with two " +
                        "meanings.",
                    },
                    defaultLocale: {
                      type: "string",
                      enum: [...MAINTAINED_LOCALES],
                      description:
                        `One of ${LOCALE_LIST}. The language the site's own chrome is in; a ` +
                        "code this build ships no strings for is refused here exactly as it " +
                        "is at creation.",
                    },
                    displayCurrencies: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Which currencies a reader may see totals in. Must include the " +
                        "journal's `baseCurrency`, which this endpoint cannot change — `GET` " +
                        "returns it under `journal`.",
                    },
                    ownerTel: {
                      type: "string",
                      description:
                        "The owner's own telephone number — `owner.tel` in config.json, and " +
                        "the only part of the `owner` block a token may write. It is where " +
                        "the owner's own WhatsApp copy of a published day goes, and that copy " +
                        "costs no credits; without it the owner is the one person the channel " +
                        "cannot reach. Include the country code — `+41 76 000 00 00`, " +
                        "`0041 76 000 00 00` or `41760000000`. A national number like " +
                        "`076 000 00 00` is refused rather than guessed at, because it means " +
                        "a different telephone in every country. Stored and returned as E.164 " +
                        "digits, whatever form it was sent in. Empty string removes it, which " +
                        "is also how the owner stops their own messages.",
                    },
                    manualRates: {
                      type: "object",
                      additionalProperties: { type: ["number", "null"] },
                      description:
                        "Rates for what the ECB does not publish, MERGED into what is there. " +
                        "The ECB's direction: `{\"VND\": 30500}` is \"1 EUR = 30 500 VND\", " +
                        "the opposite of a trip's own `rates`. `null` removes a code.",
                    },
                    travellers: {
                      type: "array",
                      maxItems: 10,
                      items: { $ref: "#/components/schemas/Traveller" },
                      description:
                        "The journal's own default party — how a trip draws its walking " +
                        "figures when it carries no `travellers:` block of its own. Replaced " +
                        "wholesale, the same as `.../trips/{trip}/travellers`: send the whole " +
                        "list, and `[]` to go back to having no default (one neutral figure). " +
                        "Ask GET /api/v1/{user}/travellers/presets for the vocabulary first; " +
                        "an unknown key inside a figure is `400 invalid_travellers` rather " +
                        "than dropped. Read back with GET /api/v1/{user}/travellers.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "The journal's features or profile afterwards, and what changed",
            },
            "400": {
              description:
                "An unknown capability, a non-boolean, an unwritable field (`owner`, " +
                "`baseCurrency`, `media`), a capability this server does not provide, one " +
                "the server decides for every journal (`capability_not_yours`: `photobook`, " +
                "`postcards`, `logging`, `credits`), `features` sent together with a " +
                "profile field (`mixed_change`), or a `travellers` figure with an unknown " +
                "field (`invalid_travellers`)",
            },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "The token belongs to a different journal, or is scoped to one trip",
            },
            "404": { description: "No such journal" },
          },
        },
      },
      "/api/v1/{user}/travellers": {
        get: {
          summary: "The journal's own default party",
          description:
            "How this journal draws its landing page's walking figures when a trip does not " +
            "say for itself — B1526. `PATCH /api/v1/{user}/config` with `{\"travellers\": " +
            "[...]}` is where it is written; `.../trips/{trip}/travellers` is the same door " +
            "one trip down. Owner only, the same gate `GET .../config` uses.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The journal's default travellers block" },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "The token belongs to a different journal, or is scoped to one trip",
            },
            "404": { description: "No such journal" },
          },
        },
      },
      [`/${example}/trips/{trip}/day/{slug}.md`]: {
        get: {
          summary: "A day's markdown source",
          security: [],
          description:
            "Any day, in any trip. The content is markdown, so this is the source " +
            "rather than a conversion of it, and it is gated exactly like the HTML " +
            "page — a private trip answers 404 here too. This is the `.md` twin of " +
            "the day's own URL, and the form to use when you have a trip id: the " +
            "search index identifies entries as `{trip}/{slug}`.",
          parameters: [
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "text/markdown" },
            "404": { description: "text/plain — never an HTML error page" },
          },
        },
      },
      [`/${example}/day/{slug}.md`]: {
        get: {
          summary: "A day's markdown source, in the current trip",
          security: [],
          description:
            "The short form, mirroring `/{user}/day/{slug}` — the current trip's day " +
            "pages. If the current trip has no such slug, the journal's other readable " +
            "trips are searched before this gives up, so a slug alone usually resolves.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "text/markdown" },
            "404": { description: "text/plain — never an HTML error page" },
          },
        },
      },
    },
  };

  return document;
}
