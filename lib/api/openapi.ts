import "server-only";
import { serverSite } from "@/lib/site";
import { getDefaultUsername, getUsernames } from "@/lib/users";
// Shared with /agent.md and /documentation.txt. A machine contract that
// disagrees with the prose about what `private` means is worse than either.
import {
  LOCALE_LIST,
  PRIVATE_SHUTS_OUT_GUESTS,
  VISIBILITY_ENUM_NOTE,
  VISIBILITY_MEANING,
  VISIBILITY_NOT_A_LOCK,
} from "@/lib/api/agentCopy";
import { EDITABLE_DAY_FIELDS } from "@/lib/api/entries";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
import { TRAVEL_SCENE_VARIANTS } from "@/lib/validate/entry";

/**
 * The machine contract for the same API `/agent.md` describes in prose.
 *
 * `/documentation.txt` has always linked here; until now the link was a 404,
 * which is the worst failure a discovery document can have — an agent follows
 * it, gets nothing, and has no way to tell whether the API exists.
 *
 * Written out beside the routes rather than generated from a decorator library:
 * there are five endpoints, and a hand-written document that is checked by a
 * test is more honest than a generated one nobody reads.
 *
 * Shared between `/openapi.json` (the machine contract) and `/docs/api` (the
 * same document, rendered for a person) so the two cannot drift into
 * describing two different APIs.
 */
export function openApiDocument() {
  const site = serverSite();
  const example = getDefaultUsername() ?? getUsernames()[0] ?? "username";

  const errorSchema = {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"],
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
        `The prose guide is at ${site.url}/agent.md.`,
      license: { name: "AGPL-3.0-or-later" },
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
            visibility: { type: "string", enum: ["public", "guest", "private"] },
            listed: {
              type: "boolean",
              description:
                "Whether the trip is advertised — sitemap, feed, trip switcher. Separate " +
                "from visibility since W27: what an unlisted-but-public trip used to mean. " +
                "Read from the trip's `listed:` key where that narrows what visibility " +
                "already implied, so a `guest` or `private` trip is always false here.",
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
                "ISO-4217, e.g. EUR. Omit it and the journal's own base currency is used.",
            },
            category: {
              type: "string",
              description: 'Free text; "other" when omitted.',
            },
          },
        },
        GalleryItem: {
          type: "object",
          required: ["src", "type"],
          description:
            "A photograph or clip on a day. **You do not write these** — POST to the media " +
            "endpoint and it puts them in the day for you. Described here because they come " +
            "back when you read a day.",
          properties: {
            src: { type: "string", description: "/{user}/media/{trip}/{day}/01.jpg" },
            type: { type: "string", enum: ["image", "video"] },
            width: { type: "integer" },
            height: { type: "integer" },
            caption: { type: "string" },
            poster: { type: "string", description: "A still, for a clip." },
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
            title: { type: "string" },
            date: { type: "string", format: "date", description: "2026-08-26" },
            time: {
              type: "string",
              pattern: "^\\d{2}:\\d{2}$",
              description: "24-hour, local to where the day happened. Orders several days that share a date.",
            },
            location: { type: "string" },
            country: { type: "string", description: "The country's name, not its code." },
            lat: { type: "number" },
            lng: { type: "number" },
            content: { type: "string", description: "The prose, as markdown." },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Lowercase letters, digits and single hyphens.",
            },
            costs: { type: "array", items: { $ref: "#/components/schemas/Cost" } },
            transportMode: {
              type: "string",
              description:
                "How the day was travelled. One of the modes /agent.md lists; anything " +
                "else is refused rather than dropped.",
            },
            transportFrom: { type: "string" },
            transportTo: { type: "string" },
            travelScene: {
              type: "string",
              description:
                `How the travel scene into this day plays. One of ${TRAVEL_SCENE_VARIANTS.join(", ")} ` +
                "changes anything; \"skip\" leaves the leg out of the story pager entirely. " +
                "Absent plays the default scene, timed to the distance covered. Any other " +
                "string is written as sent and read back as the default rather than refused.",
            },
            test: {
              type: "boolean",
              description:
                "This day did not happen — it was written to check that the software works. " +
                "The page shows a banner saying so, and the day is kept out of the feed, the " +
                "search index and the sitemap. Set it whenever you were asked to invent " +
                "content; a string here is refused rather than ignored.",
            },
            idempotency_key: {
              type: "string",
              description:
                "Names this one write. Send the same key with the same body to retry after a " +
                "dropped connection and you get the first answer back with `replayed: true`; " +
                "send it with a different body and the call is refused (409) and nothing is " +
                "written. A new key for every day.",
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
            location: { type: "string" },
            country: { type: "string", description: "The country's name, not its code." },
            lat: { type: "number" },
            lng: { type: "number", description: "Must arrive with lat in the same call." },
            content: { type: "string", description: "Replaces the entry's whole body." },
            tags: { type: "array", items: { type: "string" } },
            costs: {
              type: "array",
              items: { $ref: "#/components/schemas/Cost" },
              description: "Replaces the whole list. An empty array clears it.",
            },
            transportMode: { type: "string" },
            transportFrom: { type: "string" },
            transportTo: { type: "string" },
            travelScene: {
              type: "string",
              description: `Same meaning as on creation. One of ${TRAVEL_SCENE_VARIANTS.join(", ")}.`,
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
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Accepted" },
            "403": { description: "That address may not have an agent code for this journal" },
            "404": { description: "Authentication is off on this server" },
            "429": { description: "Too many attempts" },
            "503": {
              description:
                "`mail_disabled` — this server cannot send mail at all, so nothing was " +
                "issued and any code you already hold is still live. Or `mail_failed` — " +
                "the send was attempted and broke, so no code is live for this address " +
                "and retrying is the remedy.",
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
                    code: { type: "string", description: "Six digits. Ten minutes, single use." },
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
      "/api/v1/{user}/invites": {
        get: {
          summary: "Every invite link this journal has issued",
          description:
            "Never the tokens: only their hashes were stored, so a link that was lost has to " +
            "be reissued rather than looked up. Owner only.",
          parameters: [{ name: "user", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Links, with their kind, scope, expiry, uses and revocation" },
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such journal, or contacts are off on it" },
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
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such journal or trip, or contacts are off" },
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
            "403": { description: "Not this journal's owner" },
            "404": { description: "No such link in this journal" },
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
                    title: { type: "string" },
                    start: { type: "string", description: "2027-04-01. Required — a trip without dates is never read." },
                    end: { type: "string", description: "2027-05-15. Required." },
                    tagline: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["upcoming", "current", "past"],
                      description:
                        "Optional, and usually omitted: `past`/`upcoming` are derived " +
                        "from `start` when the trip is read. Set `current` for the trip " +
                        "served at the bare /{user} URL.",
                    },
                    accent: { type: "string", enum: ["sky", "yellow", "green", "coral", "navy"] },
                    visibility: {
                      type: "string",
                      // Most open first, which is the order a person decides
                      // in — B302. No `default` here any more (B306): the
                      // actual default is not one fixed value, it is this
                      // journal's own visibility — see VISIBILITY_ENUM_NOTE.
                      enum: ["public", "guest", "private"],
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
                    test: {
                      type: "boolean",
                      description:
                        "This trip did not happen — it exists to check that the software " +
                        "works. Every day of it gets a banner saying so, and none of it " +
                        "reaches the feed, the search index or the sitemap.",
                    },
                    intro: { type: "string" },
                    people: {
                      type: "array",
                      maxItems: 10,
                      description:
                        "Who took the trip. It is the byline AND it is write access: " +
                        "everyone named may write to the whole trip and may obtain a token " +
                        "scoped to it, using the address given. A malformed entry is refused " +
                        "by name (`invalid_people`) rather than dropped, which is what the " +
                        "reader does with one. Nothing can change this afterwards.",
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
                        "has a small number — `content/rates/ecb.json` points the other way. " +
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
            "201": { description: "Created" },
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: { email: { type: "string", format: "email" } },
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
          },
        },
      },
      "/api/v1/journals": {
        post: {
          summary: "Create a journal",
          description:
            "Takes the signup token. Answers with an agent token for the journal it just " +
            "created, so the caller can go straight on to creating a trip.",
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
                  ],
                  properties: {
                    username: { type: "string", description: "The journal's address. Permanent." },
                    title: { type: "string" },
                    tagline: { type: "string" },
                    ownerName: { type: "string" },
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
                      // The same two sentences /agent.md and /documentation.txt
                      // carry, from the one place they are written.
                      description:
                        `Required — there is no default. Whether this server advertises the ` +
                        `journal: ${VISIBILITY_MEANING} ` +
                        `${VISIBILITY_NOT_A_LOCK.replace(/`/g, "")} Ask which they want.`,
                    },
                    startLocation: { type: "string" },
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
                        `Must include defaultLocale. Each entry must be one of ${LOCALE_LIST}.`,
                    },
                    baseCurrency: { type: "string" },
                    displayCurrencies: { type: "array", items: { type: "string" } },
                    units: { type: "string", enum: ["metric", "imperial"] },
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
                "Both are absent when this server has auth off.",
            },
            "400": {
              description:
                "The username, title or owner name/nickname is not usable, or visibility, " +
                "defaultLocale or locales is missing or not a value this server accepts, or " +
                "locales does not contain defaultLocale.",
            },
            "401": { description: "Missing or invalid signup token" },
            "403": { description: "This address already owns as many journals as it may" },
            "404": { description: "Signing up is not enabled on this server" },
            "409": { description: "That username is taken" },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/days": {
        get: {
          summary: "Published days in a trip",
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
                "and nothing was written again.",
            },
            "201": { description: "Created as a draft" },
            "400": {
              description:
                "Invalid entry. The body carries a `problems` list — every problem at once, " +
                "each naming the field, what arrived and what was expected.",
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
          },
        },
        delete: {
          summary: "Delete a day",
          description:
            "Refused the first time on purpose. The first call answers 409 with " +
            "a signed `confirm` code and a question; repeat the call with that " +
            "code to go through. The code is bound to the journal, trip, day and " +
            "verb, and lasts five minutes. A published day is a different verb " +
            "from a draft, so a code issued for one will not verify against the " +
            "other. The entry file is removed; its photographs are left on disk.",
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
            "200": { description: "Deleted" },
            "400": { description: "No such day" },
            "409": { description: "Confirmation required — the body carries the code" },
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
            "**Sending costs credits where this server charges for them** — B366, one per " +
            "email and one per WhatsApp message. Both requested channels are priced " +
            "together against one balance *before* anything is published: if the journal " +
            "cannot cover the whole send, this answers **402** with `needed` and `balance`, " +
            "the day stays a draft and nothing is sent. It is all-or-nothing, so a partial " +
            "delivery is never the outcome. A publish with neither flag is never charged " +
            "and never refused for credits. `GET /api/v1/{user}/status` carries the balance; " +
            "read it first rather than discovering an empty account here. Only the journal's " +
            "owner can add credits, and only from a shell on the server — there is no " +
            "purchase call, so a 402 is a message to pass on, never something to retry " +
            "around.",
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
            "200": { description: "Published; the body carries the day's public URL" },
            "400": { description: "The day could not be published — the body says why" },
            "402": {
              description:
                "Not enough credits for the send this call asked for. Nothing was " +
                "published and nothing was charged; `needed` and `balance` say by how much.",
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
            "refuses outright rather than sending nothing quietly.",
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
            "The whole entry — content, gallery, costs, tags, translations — and a `status` " +
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
                "in `unsupported_field` rather than silently dropped.",
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
          summary: "Remove costs.md — how the costs page goes away",
          description:
            "Whole file, not just the `budget:` line: the costs page is presence-driven " +
            "(B293) and `hasCostsData` (B267) is what decides it exists, by asking whether " +
            "`costs.md` is there at all — so this removes the file entirely, and the " +
            "response says the page is gone rather than leaving that to be inferred.\n\n" +
            "Not idempotent in status: calling this on a trip with no costs.md answers 404, " +
            "since there was nothing here to remove.\n\n" +
            "Same authority as writing a day: whoever may write to this trip may remove its " +
            "budget, trip-scoped tokens included.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Removed. `costsPageGone: true` — the page will not appear in the trip's nav." },
            "401": { description: "Missing or invalid token" },
            "403": { description: "The token belongs to a different journal" },
            "404": { description: "No such trip, or this trip has no costs.md" },
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
            "trip is advertised in the sitemap, the feed and the trip switcher.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The trip's visibility and listed flag" },
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
            "**Send only what changes** — `visibility`, `listed`, or both. An unrecognised " +
            "`visibility` is refused rather than written and read back as `private` later, " +
            "the same rule the file's own reader already follows. `listed: true` is refused " +
            "on a trip whose visibility does not already advertise it (B51) — only `public` " +
            "does.\n\n" +
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
                    visibility: { type: "string", enum: ["private", "public", "guest"] },
                    listed: { type: "boolean" },
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
                "Invalid JSON, neither field named, an unrecognised visibility, or a listed: " +
                "true this trip's visibility does not advertise.",
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
            "original for print. Send the largest you have — for a URL upload the original " +
            "is whatever the remote host served, so a 2000px source is what a photobook " +
            "will be printed from, and there is no way to get the pixels back later.",
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
                    files: { type: "array", items: { type: "string", format: "binary" } },
                  },
                },
              },
              "application/json": {
                schema: {
                  type: "object",
                  required: ["day", "urls"],
                  properties: {
                    day: { type: "string" },
                    urls: {
                      type: "array",
                      items: { type: "string", format: "uri" },
                      description:
                        "https URLs on public hosts. All or nothing: if any is refused, " +
                        "nothing is written and the reply names which and why.",
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
                "rather than taking it on trust. `attached` is false only if the entry has " +
                "no frontmatter to write into, in which case the files are still on disk " +
                "and `items` is what to add by hand. `note` says plainly when the day is " +
                "already published, so anyone reading it can now see the addition.",
            },
            "400": { description: "A file, a URL, or the day was rejected — the response says which and why" },
            "413": { description: "Over a size limit this instance sets" },
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
      "/api/v1/{user}/status": {
        get: {
          summary: "Where you stand, in one call",
          description:
            "The first call to make, and the cheapest credential check there is: `401` " +
            "means go and get a code, `200` means you are in. Carries the journal, the " +
            "drafts waiting for a person to approve them — each with the call that " +
            "publishes it — the trips this token may write to, which capabilities are on " +
            "for this journal and why any is off, and a `next` saying what to do. " +
            "`scope` says whether you are holding the whole journal or one trip's slice; " +
            "do not report a slice as the journal's total.\n\n" +
            "**`credits`** is here when this server charges for sends (B366): `balance`, " +
            "and what each channel costs. Read it before publishing with `send_mail` or " +
            "`send_whatsapp` — a balance too small refuses the whole publish with 402 and " +
            "writes nothing. Absent means this server does not bill, not that the account " +
            "is empty; it is also absent for a trip-scoped token, which can neither " +
            "publish nor send.",
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
          responses: { "200": { description: "Drafts" } },
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
                "config.json under `journal` — including the `baseCurrency` a " +
                "`displayCurrencies` must contain",
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
            "`locales`, `defaultLocale`, `displayCurrencies`, `manualRates`. Before this " +
            "there was no endpoint, tool or page that wrote a journal's config at all, so it " +
            "was fixed at creation and only an operator with a shell could change it — which " +
            "left journals unable to invite anybody (B182) and a title typoed at signup " +
            "permanent (B220).\n\nCapabilities can only ask for what the server already " +
            "provides: the server's own config is a ceiling, and asking to exceed it is " +
            "refused with the reason rather than written and silently ignored. Switching a " +
            "capability *off* always works.\n\n**Capabilities and the rest are two calls.** " +
            "A body naming `features` alongside another field is `400 mixed_change` and " +
            "writes nothing: each call rewrites config.json whole, reads it back, and " +
            "restores the previous bytes if it does not load, so a request doing that twice " +
            "is one that can succeed halfway.\n\nThree keys are never writable, each with " +
            "its own reason in the refusal. `owner.email` decides who can obtain a token for " +
            "this journal, so a token must not be able to move it. `baseCurrency` is not a " +
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
                      additionalProperties: { type: "boolean" },
                      description:
                        "Capability name to true or false. Omitted ones are left alone. Not " +
                        "combinable with the fields below — send it in a call of its own.",
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
                      items: { type: "string" },
                      description:
                        "Language codes, most preferred first. Must contain `defaultLocale`; " +
                        "a pair that disagrees is refused rather than written, because the " +
                        "resulting config would take the journal off the site entirely.",
                    },
                    defaultLocale: { type: "string" },
                    displayCurrencies: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Which currencies a reader may see totals in. Must include the " +
                        "journal's `baseCurrency`, which this endpoint cannot change — `GET` " +
                        "returns it under `journal`.",
                    },
                    manualRates: {
                      type: "object",
                      additionalProperties: { type: ["number", "null"] },
                      description:
                        "Rates for what the ECB does not publish, MERGED into what is there. " +
                        "The ECB's direction: `{\"VND\": 30500}` is \"1 EUR = 30 500 VND\", " +
                        "the opposite of a trip's own `rates`. `null` removes a code.",
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
                "`baseCurrency`, `media`), a capability this server does not provide, or " +
                "`features` sent together with a profile field (`mixed_change`)",
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
