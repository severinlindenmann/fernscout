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
import { CODE_TTL_MINUTES, HANDOVER_TTL_MINUTES } from "@/lib/auth";

/** Markdown emphasis is prose's, not a JSON `description`'s — the same trim
 * `VISIBILITY_NOT_A_LOCK` gets a few lines down, done once. */
const plain = (text: string) => text.replace(/[`*]/g, "");
import { INBOX_FILE_EXTENSIONS, INBOX_KINDS } from "@/lib/inbox";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
import { CREDENTIAL_FOR } from "@/lib/api/v2/schemas/auth";
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
import { CAPTION_MAX_CHARS, IMAGE_FORMATS, VIDEO_FORMATS } from "@/lib/validate/media";

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
            "values each one takes are published by GET /api/v2/{user}/figures/presets " +
            "(moved from /api/v1/{user}/travellers/presets, B1609) along with twelve worked " +
            "examples: ask it rather than guessing, because an unrecognised value is refused " +
            "and an unrecognised key is refused too. GET …/figures/preview draws a figure so " +
            "a person can see themselves before it is written, which is the honest way to " +
            "settle \"is this you?\".",
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
      "/api/auth/codes": {
        post: {
          summary: "Ask for a one-time code — B1600, one door for four credentials",
          security: [],
          description:
            "Replaces v1's `/api/auth/request`, `/api/auth/identity/request` and " +
            "`/api/auth/signup/request`: one door, parameterised by `for`, rather than " +
            "three copies of the rate limit and the uniform-202 rule. `for` is the wire " +
            `name for which credential this code redeems into: ${CREDENTIAL_FOR.join(", ")} — ` +
            '"read" and "write" are what v1 called `kind: "guest"`/`"agent"`.\n\n' +
            "**Always answers 202, whether or not the address owns anything** — so it " +
            "cannot be used to discover which addresses exist. The one exception, and it " +
            "does not vary with the address either: `for: \"write\"` to an address that " +
            "neither owns the journal nor is on the trip named answers 403 rather than " +
            "leaving you waiting for a code that was never coming.\n\n" +
            "**A new request invalidates the previous code.** Two of these mails look " +
            "identical apart from the time in them, and only the newest code works — so " +
            "if you ask twice, make sure the person reads out the newest one.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "for"],
                  properties: {
                    email: { type: "string", format: "email" },
                    for: {
                      type: "string",
                      enum: [...CREDENTIAL_FOR],
                      description:
                        "Which credential this code will redeem into. `read`/`write` name a " +
                        "journal and need `user`; `identity`/`signup` name none and refuse it.",
                    },
                    user: {
                      type: "string",
                      description:
                        "The journal's address — the same segment that appears in its URLs. " +
                        'Required with `for: "read"` or `"write"`; refused otherwise, since ' +
                        "`identity` and `signup` name no journal.",
                    },
                    scope: {
                      type: "object",
                      required: ["trip"],
                      properties: { trip: { type: "string" } },
                      description:
                        'Only meaningful with `for: "write"`, and refused otherwise: names the ' +
                        "one trip this code may mint a token for, for somebody who is on a " +
                        "trip but does not own the journal. Absent and the address is the " +
                        "owner's own: the journal-wide token. Absent and it is not: refused.",
                    },
                    destination: {
                      type: "string",
                      description:
                        "Where the one-tap link in the mail should land, for the browser " +
                        'sign-in form: the path the reader was on. `for: "read"` only — a ' +
                        "write code has no link. Stored with the code and never appears in " +
                        "the mailed URL; anything that is not a path inside `/{user}/` is " +
                        "ignored, landing the reader on the journal instead.",
                    },
                    channel: {
                      type: "string",
                      enum: ["mail", "whatsapp"],
                      default: "mail",
                      description:
                        "How the code travels. `whatsapp` sends it as a WhatsApp message to " +
                        "the number the journal's owner proved at signup — so it only ever " +
                        "delivers for the owner's own address; anything else answers the " +
                        "same 202 with nothing sent, exactly like an unknown address by mail. " +
                        "A server without WhatsApp answers 503 `whatsapp_disabled`. Not " +
                        'offered for `for: "identity"`/`"signup"`: neither names a journal ' +
                        "with an owner's number to check against.",
                    },
                    locale: {
                      type: "string",
                      enum: [...MAINTAINED_LOCALES],
                      description:
                        `One of ${LOCALE_LIST}. Overrides the request's own language signal ` +
                        "outright — sent, it wins with no reconciliation and no warning " +
                        'either way. Meaningful only for `for: "identity"`/`"signup"`, which ' +
                        "have no journal to read a default locale off.",
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
                "`invalid_email` — missing or not a syntactically valid address. Or " +
                "`invalid_request` — `user` missing where required or present where " +
                "refused, or `scope` present where refused. All shape checks that never " +
                "touch a lookup, so refusing them names nothing about who is registered — " +
                "unlike an unrecognised-but-valid address, which still answers 202.",
            },
            "403": {
              description:
                "That address may not have a write code for this journal, or — for " +
                '`for: "signup"` — this instance is invite-only and the address is not on its ' +
                "list (`signup_not_invited`).",
            },
            "404": {
              description:
                '`auth_disabled` (`for: "read"`/`"write"`/`"identity"`) or `signup_disabled` ' +
                '(`for: "signup"`) — the relevant capability is off, server-wide or, for ' +
                '`"read"`/`"write"`, on this journal.',
            },
            "429": { description: "Too many attempts — the ceiling is narrower for `for: \"write\"`" },
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
      "/api/auth/codes/redeem": {
        post: {
          summary: "Spend a code — B1600, one door for four credentials",
          security: [],
          description:
            "Replaces v1's `/api/auth/verify`, `/api/auth/identity/verify` and " +
            '`/api/auth/signup/verify`. `for: "read"`/`"identity"` set a cookie and put no ' +
            'token in the body (decision 24); `for: "write"`/`"signup"` return the token ' +
            "in the body and set no cookie, because the caller is a program with no cookie " +
            "jar. A wrong code, an expired one, a burned one, the wrong `for`, or a " +
            "`scope.trip` that does not match the trip bound to the code all answer the " +
            "identical `invalid_code` — distinguishing them would let a caller holding no " +
            "code learn something about someone else's.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "code", "for"],
                  properties: {
                    email: { type: "string", format: "email" },
                    code: { type: "string", description: `Six digits. ${CODE_TTL_MINUTES} minutes, single use.` },
                    for: { type: "string", enum: [...CREDENTIAL_FOR], description: "Must match what the code was issued as." },
                    user: {
                      type: "string",
                      description: 'Required with `for: "read"`/`"write"`; refused otherwise.',
                    },
                    scope: {
                      type: "object",
                      required: ["trip"],
                      properties: { trip: { type: "string" } },
                      description:
                        '`for: "write"` only: the trip travels on the code, and the token is ' +
                        "scoped to it whether or not this is sent. Naming a different one is " +
                        "refused with the same `invalid_code` as a wrong digit.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                '`for: "read"`/`"identity"` — `{ok, expires, scope}`, the cookie set on the ' +
                'response. `for: "write"`/`"signup"` — `{ok, token, expires, scope, user}`, ' +
                "the token in the body.",
            },
            "401": { description: "`invalid_code` — wrong, expired, burned, or the wrong `for`" },
            "404": { description: '`auth_disabled` or `signup_disabled`, matching /api/auth/codes' },
            "403": {
              description:
                '`signup_not_invited` — this instance is invite-only and the address is not on ' +
                "its list. The code is not spent.",
            },
            "429": { description: "Too many attempts" },
          },
        },
      },
      "/api/auth/links/redeem": {
        post: {
          summary: "Spend a one-click sign-in link — B1600",
          security: [],
          description:
            "Replaces v1's `/api/auth/link` and `/api/auth/identity/link`. `POST` only: " +
            "a mail scanner follows a link, it does not submit a form (B142), so acting on " +
            'arrival cost a reader their own sign-in. `for` is `"read"` or `"identity"` ' +
            "only — an agent has no browser to follow a link, and a signup link would " +
            "quietly create a journal on arrival, which nobody has ever wanted.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["token", "for"],
                  properties: {
                    token: { type: "string", description: "The link's own token, from the URL." },
                    for: { type: "string", enum: ["read", "identity"] },
                    user: {
                      type: "string",
                      description: 'Required with `for: "read"`; refused with `for: "identity"`.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "`{ok, next}` — the cookie is set on the response; `next` is where to land." },
            "401": { description: "`link_spent` — never followed, already spent, or expired; one answer for all three" },
            "404": { description: "No such journal, or authentication is off" },
            "429": { description: "Too many attempts" },
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
      "/api/auth/signup/phone": {
        post: {
          summary: "Prove a telephone number, step one — B1065/B1234",
          description:
            "Renamed from /api/auth/signup/phone/request for v2 (auth.md §2.6); behaviour " +
            "unchanged. The second half of proving who is signing up, after the address. " +
            "Takes the signup token from /api/auth/codes/redeem (for: \"signup\"). The " +
            "`phone_required` refusal on " +
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
                "is on its way; pass `id` and the code to /api/auth/signup/phone/redeem. " +
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
      "/api/auth/signup/phone/redeem": {
        post: {
          summary: "Prove a telephone number, step two — B1065/B1234",
          description:
            "Renamed from /api/auth/signup/phone/verify for v2 (auth.md §2.6); behaviour " +
            "unchanged. Takes the signup token, the `id` from the request step, and — in code mode — " +
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
      // "/api/v1/{user}/sync/manifest", "/api/v1/{user}/sync/file/{path}"
      // and "/api/v1/{user}/import" are gone; their v2 doors are
      // "/api/v2/{user}/sync/manifest", "/api/v2/{user}/sync/file/{path}"
      // and "/api/v2/{user}/import", documented in /api/v2/openapi.json
      // instead. "/api/v1/{user}/trips/{trip}/track" stays below — it has no
      // v2 door yet.
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
      // "/api/v1/{user}/trips/{trip}/media/duplicates" is gone; its v2 door
      // is "/api/v2/{user}/trips/{trip}/media/duplicates", documented in
      // /api/v2/openapi.json instead.
      "/api/auth/handover": {
        post: {
          summary: "Spend a handover credential for your own 7-day token",
          description:
            "The first call an agent makes when the owner pasted a prompt instead of " +
            "reading out a code. Send the handover credential as `Authorization: Bearer`. " +
            `It lasts ${HANDOVER_TTL_MINUTES} minutes, is spent by succeeding here, and is refused on every ` +
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
      "/api/auth/{user}/handover": {
        post: {
          summary: "Issue a handover credential (owner only)",
          description:
            "Moved from /api/v1/{user}/handover for v2 (auth.md §2.5): minting and " +
            "exchanging a credential belongs under /api/auth regardless of which journal " +
            "it names, so both halves now live together. What the owner's own access page " +
            "calls so it can print a pasteable prompt. Owner only, cookie or bearer — and a " +
            "bearer that resolves to a live agent session counts only when its scope is " +
            "the unqualified journal-wide one; a token scoped to a single trip is refused " +
            "even when it belongs to the owner's own address, because a credential good " +
            "for one trip must not mint a journal-wide handover. The credential it answers " +
            `with (\`handover\`) lasts ${HANDOVER_TTL_MINUTES} minutes and can only be exchanged at ` +
            "POST /api/auth/handover — never used to read or write.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description:
                `\`{handover, expiresAt, minutes, exchange, next}\` — a ${HANDOVER_TTL_MINUTES}-minute handover ` +
                "credential, the URL that spends it, and what to do next",
            },
            "403": {
              description:
                "Not this journal's owner, or a bearer token that resolves to a live agent " +
                "session scoped to one trip rather than the whole journal",
            },
            "404": { description: "No such journal, or sign-in is off for it (`auth_disabled`)" },
            "409": {
              description: "This journal's config.json names no owner address (`no_owner_address`)",
            },
          },
        },
      },
      /**
       * The rest of the bearer-token surface — added in B540, because every
       * one of these was reachable, documented nowhere, and therefore
       * invisible to the only reader this document has. Two of them,
       * `travellers/presets` and `travellers/preview`, were named in
       * AGENTS.md as doors an agent should use and were still absent here;
       * both have since moved to `/api/v2/{user}/figures/presets` and
       * `.../preview` (B1609) and no longer live under this prefix.
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
                          "an absent feature is absent. `{ enabled: true, note }` says the " +
                          "thing `enabled: true` on its own does not: a print provider set " +
                          "to `dry-run` composes orders and posts nothing, and `signup` is " +
                          "on everywhere the server can take a signup at all while " +
                          "`inviteOnly` decides whether anybody uninvited actually can. " +
                          "Read the note before concluding what a capability will do.",
                        properties: Object.fromEntries(
                          FEATURE_NAMES.map((name) => [
                            name,
                            {
                              type: "object",
                              properties: {
                                enabled: { type: "boolean" },
                                reason: { type: "string" },
                                note: { type: "string" },
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
      // "/api/v1/{user}/travellers/presets" and "/preview" moved to
      // "/api/v2/{user}/figures/presets" and "/preview" (B1609) — this
      // document is scoped to /api/v1 and /api/auth (see
      // test/openapi-contract.test.ts), and the v2 door is documented in the
      // generated /api/v2/openapi.json instead (phase 2 step 6).
      //
      // "/api/v1/{user}/trips/{trip}/travellers/from-photo" is gone the same
      // way: its v2 door is "/api/v2/{user}/trips/{trip}/travellers/from-photo",
      // documented in /api/v2/openapi.json instead.
      "/api/auth/{user}/keys": {
        get: {
          summary:
            "The tokens and sessions that can write here — the owner sees every row, " +
            "anybody else only their own (B323)",
          description:
            "Moved from /api/v1/{user}/keys for v2 (auth.md §2.7). Kept as one mixed door " +
            "on purpose rather than splitting an owner door from a keys/mine door. The " +
            "owner gets one row per live credential in the journal, each with `email`. " +
            "Anybody else who has proved an address — a guest cookie, a year-long identity, " +
            "or a trip-scoped bearer token — gets only the rows issued to *that* address, " +
            "with no `email` field (the list is already implicitly theirs). There is no " +
            "parameter that widens this: the filter is the caller's own proven address, " +
            "never anything the request sends. Every row carries `scope`, translated from " +
            "the internal `write:trip:…` vocabulary into `\"owner\"` or `\"trip\"` (with " +
            "`trip` alongside it when it is one), and `kind`, translated the same way the " +
            "rest of this area's wire vocabulary was (`CREDENTIAL_FOR`): `\"write\"` for a " +
            "live agent token, `\"handover\"` for a live handover credential — `handover` " +
            "is not a `for` value and keeps its own name, since it is minted and exchanged " +
            "by its own pair of routes rather than redeemed from a code.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description:
                "One row per live credential this caller may see, with its kind " +
                `(\`${["write", "handover"].join("\`, \`")}\`), scope (\`${["owner", "trip"].join("\`, \`")}\`, plus ` +
                "`trip` for a trip-scoped one) and expiry",
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
            "Moved from /api/v1/{user}/keys for v2 (auth.md §2.7). " +
            "`{\"revoke\": \"<key id>\"}`, with an id from the GET above. It ends that " +
            "credential immediately — the way to answer \"an agent has a token I want back\". " +
            "An id that is not this journal's, or — for a non-owner — not this caller's own " +
            "row, answers the same `404` (`unknown_key`) as an id that does not exist at all, " +
            "so a guess learns nothing.",
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
            "400": { description: "No key id sent (`invalid_request`)" },
            "403": {
              description:
                "No proven address at all. For an address that owns the journal this also " +
                "covers a journal that does not exist, checked before the capability is " +
                "(B340).",
            },
            "404": {
              description:
                "No such key (`unknown_key`) — either it does not exist, or (for a " +
                "non-owner) it belongs to somebody else's address",
            },
            "409": {
              description: "A proven address on this journal, but sign-in is off on it (`auth_disabled`)",
            },
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
