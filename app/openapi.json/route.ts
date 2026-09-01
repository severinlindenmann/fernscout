import { serverSite } from "@/lib/site";
import { getDefaultUsername, getUsernames } from "@/lib/users";
// Shared with /agent.md and /documentation.txt. A machine contract that
// disagrees with the prose about what `private` means is worse than either.
import { VISIBILITY_MEANING, VISIBILITY_NOT_A_LOCK } from "@/lib/api/agentCopy";

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
 */
export function GET() {
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
        "Everything created through this API is a draft: it is not on the site " +
        "until a person publishes it, and no parameter skips that. The prose " +
        `guide is at ${site.url}/agent.md.`,
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
                "Whether the trip appears in listings. Separate from visibility " +
                "since W27: what an unlisted-but-public trip used to mean.",
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
      },
    },
    paths: {
      "/api/auth/request": {
        post: {
          summary: "Ask for a one-time code",
          security: [],
          description:
            "Always answers 202, whether or not the address owns anything — so " +
            "it cannot be used to discover which addresses exist. The one " +
            "exception is an agent code for an address that neither owns the " +
            "journal nor is on the trip you named, which answers 403 rather than " +
            "leaving you waiting for a code that was never coming.\n\n" +
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
                "The code could not be sent, so no code is live for this address. Retry.",
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
                    trip: { type: "string", description: "The same trip named in the request." },
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
          summary: "Create a trip (owner only; private unless asked otherwise)",
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
                    visibility: { type: "string", enum: ["private", "public", "guest"], default: "private" },
                    listed: { type: "boolean" },
                    test: {
                      type: "boolean",
                      description:
                        "This trip did not happen — it exists to check that the software " +
                        "works. Every day of it gets a banner saying so, and none of it " +
                        "reaches the feed, the search index or the sitemap.",
                    },
                    intro: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created" },
            "400": { description: "The id, title or dates are not usable" },
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
                  required: ["username", "title", "ownerName", "ownerNickname"],
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
                        "is not first, so there is no safe guess. Ask.",
                    },
                    visibility: {
                      type: "string",
                      enum: ["public", "private"],
                      default: "public",
                      // The same two sentences /agent.md and /documentation.txt
                      // carry, from the one place they are written.
                      description:
                        `Whether this server advertises the journal: ${VISIBILITY_MEANING} ` +
                        `${VISIBILITY_NOT_A_LOCK.replace(/`/g, "")} Ask which they want.`,
                    },
                    startLocation: { type: "string" },
                    defaultLocale: { type: "string" },
                    locales: { type: "array", items: { type: "string" } },
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
                "yourself — opening it spends it. Absent when this server has auth off.",
            },
            "400": { description: "The username, title or owner name/nickname is not usable" },
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
          summary: "Publish a draft — the step the draft rule reserves for a person",
          description:
            "Puts a draft on the site. **Ask the person first, in words, and wait for an " +
            "answer** — this endpoint exists because the person deciding often has no text " +
            "editor and has never seen the content folder, not because the decision moved " +
            "to you.\n\n" +
            "Refused the first time, always, with a `confirm` code bound to this journal, " +
            "trip, day and verb; repeat the call carrying it. A code issued to delete will " +
            "not publish, and one issued for another day will not verify.\n\n" +
            "Owner only: a token scoped to a single trip writes days into it and cannot put " +
            "them on the site. Nothing sent to the days POST can publish — writing and " +
            "publishing are two calls, and that is the part that is structural.\n\n" +
            "It does not really come back. Taking a day down removes it from the journal, " +
            "the feed and the search index, not from the people who have read it.",
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
                    confirm: {
                      type: "string",
                      description:
                        "The code from the 409. Omit it to be issued one. Do not invent " +
                        "one — it is signed and will not verify.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Published; the body carries the day's public URL" },
            "400": { description: "The day could not be published — the body says why" },
            "401": { description: "Missing or invalid token" },
            "403": {
              description:
                "Another journal's token, or one scoped to a single trip — which may write " +
                "days but not publish them",
            },
            "404": { description: "No such trip, or no such day" },
            "409": {
              description:
                "Confirmation required — the body carries the code and the question. Also " +
                "returned when the day is already on the site.",
            },
          },
        },
      },
      "/api/v1/{user}/trips/{trip}/days/{slug}": {
        get: {
          summary: "One day in full, drafts included",
          description:
            "The whole entry — content, gallery, costs, tags — and a `status` " +
            "of `draft` or `published`. This is how you read back something you " +
            "have just written, before telling a person it is ready. Scoped like " +
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
                "and `items` is what to add by hand.",
            },
            "400": { description: "A file, a URL, or the day was rejected — the response says which and why" },
            "409": { description: "That day is published; changing what people have read is a person's job" },
            "413": { description: "Over a size limit this instance sets" },
          },
        },
      },
      "/api/v1/{user}/drafts": {
        get: {
          summary: "Everything waiting for a person to publish",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Drafts" } },
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

  return Response.json(document, {
    headers: {
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=300",
    },
  });
}
