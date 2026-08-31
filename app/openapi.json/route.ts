import { serverSite } from "@/lib/site";
import { getDefaultUsername, getUsernames } from "@/lib/users";

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
            status: { type: "string", enum: ["current", "upcoming", "past"] },
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
        Draft: {
          type: "object",
          required: ["title", "date", "content"],
          properties: {
            title: { type: "string" },
            date: { type: "string", format: "date" },
            time: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
            location: { type: "string" },
            country: { type: "string" },
            lat: { type: "number" },
            lng: { type: "number" },
            content: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
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
            "it cannot be used to discover which addresses exist.",
          responses: { "202": { description: "Accepted" } },
        },
      },
      "/api/auth/verify": {
        post: {
          summary: "Exchange a code for a token",
          security: [],
          responses: {
            "200": { description: "A token, its expiry and its scope" },
            "401": { description: "Invalid code" },
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
            "gets 409 rather than overwriting it.",
          parameters: [
            { name: "user", in: "path", required: true, schema: { type: "string" } },
            { name: "trip", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "201": { description: "Created as a draft" },
            "400": { description: "Invalid entry" },
            "409": { description: "An entry already exists for that date and title" },
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
          summary: "Upload photographs or video to a day",
          description:
            "multipart/form-data: `day` is the slug of a day that already exists " +
            "in this trip, and `files` may repeat. Two files are kept for each " +
            "one sent — a resized copy for the browser and the original for " +
            "print. Answers with the `gallery:` block to paste into the entry.",
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
                    day: { type: "string" },
                    files: { type: "array", items: { type: "string", format: "binary" } },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Written; the response carries the gallery block" },
            "400": { description: "A file, or the day, was rejected — the response says which and why" },
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
      [`/${example}/day/{slug}.md`]: {
        get: {
          summary: "A day's markdown source",
          security: [],
          description:
            "The content is markdown, so this is the source rather than a " +
            "conversion of it. Gated exactly like the HTML page.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "text/markdown" } },
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
