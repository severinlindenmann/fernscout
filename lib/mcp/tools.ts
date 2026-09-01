import "server-only";
import MiniSearch from "minisearch";
import { SESSION_SCOPE, SIGNUP_OWNER, type Session } from "../auth";
import type { Trip } from "../types";
import { attachGallery, createDraft, deleteEntry, entrySummary, isPublished, listDrafts, publishDraft, tripSummary, type DraftInput } from "../api/entries";
import { getAllEntries, getEntryBySlug } from "../entries";
import { stripMarkdown } from "../markdownText";
import { SEARCH_OPTIONS, type SearchDoc } from "../searchOptions";
import { getTrip, getTrips, tripRef } from "../trips";
import { scopeAllows } from "../tripPeople";
import { validateEntry, type Problem } from "../validate/entry";
import { createJournal } from "../journals";
import { createTrip } from "../tripWrite";
import { serverSite } from "../site";
import { storeUploads, type KeptOriginal, type UploadCandidate } from "../api/media";
import { fetchImage } from "../api/fetchMedia";
import { getUser } from "../users";
import { confirmationMatches, confirmationRequired } from "../agentConfirm";
import { DELETION_TTL_MINUTES, humanBytes, requestDeletion } from "../deletions";
import { fingerprintOf, idempotencyKey, recall, remember } from "./idempotency";

/**
 * The tools an MCP client may call, and what they do.
 *
 * Every one of them is scoped by the **session**, never by an argument. There
 * is no `user` parameter anywhere in this file: a token proves which journal it
 * belongs to, and that is the only thing that decides which folder is read or
 * written. A tool that took a username would be a tool that could be asked for
 * somebody else's.
 *
 * Nothing here makes an outbound request, so the client's token cannot be
 * forwarded anywhere — the MCP specification requires a server never to pass a
 * client's token downstream, and the cheapest way to honour that is to have no
 * downstream at all. These are filesystem reads and one filesystem write.
 */

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

export type ToolOutcome =
  | { ok: true; text: string; data: Record<string, unknown> }
  | { ok: false; error: string };

type Args = Record<string, unknown>;
/**
 * A tool's implementation.
 *
 * Allowed to be async because one of them writes files — `add_media` decodes
 * and resizes a photograph, which sharp does off-thread. Every other handler
 * is still synchronous and stays that way; `callTool` awaits regardless, so a
 * handler's own shape is nobody else's problem.
 */
type Handler = (session: Session, args: Args) => ToolOutcome | Promise<ToolOutcome>;

// ---------------------------------------------------------------------------
// Argument handling
// ---------------------------------------------------------------------------

function optionalString(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" ? value : String(value);
}

/**
 * Turn a trip id into a ref belonging to *this* session.
 *
 * A ref-shaped argument (`someone-else/their-trip`) is refused by name rather
 * than being quietly mangled. `tripRef()` would produce `me/someone-else/their-trip`,
 * which `parseTripRef` rejects and which therefore resolves to nothing anyway —
 * but "unknown trip" is a confusing answer to an attempt to reach across a
 * boundary, and a confusing answer is one an agent works around.
 */
function resolveTrip(session: Session, args: Args): { ok: true; ref: string } | { ok: false; error: string } {
  const raw = optionalString(args, "trip");
  if (!raw) return { ok: false, error: "trip is required — the trip's id, as list_trips reports it" };
  if (raw.includes("/")) {
    return {
      ok: false,
      error:
        `trip must be a plain id such as "japan-2027", not "${raw}". This token is ` +
        `scoped to the journal "${session.owner}" and cannot address another one.`,
    };
  }
  const ref = tripRef(session.owner, raw);
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: `unknown_trip: no trip "${raw}" in ${session.owner}` };
  // A token held by somebody who took one trip reaches that trip. The same
  // wording as an unknown trip on purpose: which other trips exist in this
  // journal is not something a guest of one of them gets to enumerate.
  if (!scopeAllows(session.scope, trip)) {
    return { ok: false, error: `unknown_trip: no trip "${raw}" in ${session.owner}` };
  }
  return { ok: true, ref };
}

/** The trips this session may act on — the whole journal, or the one trip. */
function reachableTrips(session: Session) {
  return getTrips(session.owner).filter((trip) => scopeAllows(session.scope, trip));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * The searchable corpus for one journal.
 *
 * Deliberately wider than `/<user>/search-index.json`, which only indexes trips
 * the public may see. The caller here holds a token for this journal, so their
 * own unlisted and password-protected trips are theirs to search. Drafts are
 * still absent, because `getAllEntries` filters them — a draft is found through
 * `list_drafts`, which is the tool that says what it is.
 */
function searchDocs(username: string, trips: Trip[]): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const trip of trips) {
    for (const entry of getAllEntries(trip.ref)) {
      docs.push({
        id: `${trip.id}/${entry.slug}`,
        title: entry.title,
        location: entry.location,
        country: entry.country,
        tripTitle: trip.title,
        date: entry.date,
        url: `/${username}/trips/${trip.id}/day/${entry.slug}`,
        body: stripMarkdown(entry.content),
      });
    }
  }
  return docs;
}

/** One line per problem — a tool error is plain text, so the list has to read
 * on its own rather than lean on the JSON structure the REST route's
 * `{ error, problems }` body can. */
function describeProblems(problems: Problem[]): string {
  return problems.map((p) => `${p.field}: got ${p.got}, expected ${p.expected}`).join("; ");
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const listTrips: Handler = (session) => {
  const trips = reachableTrips(session)
    .map((trip) => tripSummary(session.owner, trip.id))
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const text = trips.length
    ? trips
        .map(
          (t) =>
            `${t.id} — ${t.title} (${t.status}, ${t.start} to ${t.end}) · ` +
            `${t.entries} entries, ${t.drafts} draft${t.drafts === 1 ? "" : "s"}`,
        )
        .join("\n")
    : "No trips yet in this journal.";

  return { ok: true, text, data: { user: session.owner, trips } };
};

const getDay: Handler = (session, args) => {
  const trip = resolveTrip(session, args);
  if (!trip.ok) return trip;

  const slug = optionalString(args, "slug");
  if (!slug) return { ok: false, error: "slug is required — as list_trips and search_entries report it" };

  // Drafts included. This session already holds a token that may *write* to
  // this trip, so withholding what it has itself written protects nobody — and
  // an agent that cannot read its own draft back cannot check its work before
  // telling a person it is ready, which is exactly what we ask it to do.
  const entry = getEntryBySlug(trip.ref, slug, { includeDrafts: true });
  if (!entry) return { ok: false, error: `unknown_day: no entry "${slug}" in ${trip.ref}` };

  // The markdown, not a rendering of it. There is no conversion here and so
  // nothing that can drift from what a reader sees.
  const text = [
    `# ${entry.title}`,
    "",
    `${entry.date}${entry.time ? ` ${entry.time}` : ""} · ${entry.location}${entry.country ? `, ${entry.country}` : ""}`,
    // Said in the text, not only in the data: an agent summarising this to a
    // person must not describe a draft as though it were on the site.
    ...(entry.draft ? ["", "**Draft — not on the site.** A person publishes it."] : []),
    // Said in the text as well as the data, for the same reason as the draft
    // line above: an agent summarising this must not describe a day nobody
    // lived as though it recorded something.
    ...(entry.test
      ? ["", "**Test content — this day did not happen.** It exists to check the software."]
      : []),
    "",
    entry.content,
  ].join("\n");

  return {
    ok: true,
    text,
    data: {
      trip: trip.ref,
      ...entrySummary(entry),
      tags: entry.tags,
      costs: entry.costs,
      ...(entry.transport ? { transport: entry.transport } : {}),
      ...(entry.test ? { test: true } : {}),
      content: entry.content,
      status: entry.draft ? "draft" : "published",
    },
  };
};

const searchEntries: Handler = (session, args) => {
  const query = optionalString(args, "query");
  if (!query) return { ok: false, error: "query is required" };

  const rawLimit = args.limit;
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
      : 10;

  const index = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
  // Only what this token may reach, so search cannot be used to enumerate
  // the trips a scoped token is not on.
  index.addAll(searchDocs(session.owner, reachableTrips(session)));

  const hits = index
    .search(query, { prefix: true, fuzzy: 0.2 })
    .slice(0, limit)
    .map((hit) => ({
      trip: String(hit.id).slice(0, String(hit.id).indexOf("/")),
      slug: String(hit.id).slice(String(hit.id).indexOf("/") + 1),
      title: hit.title as string,
      date: hit.date as string,
      location: hit.location as string,
      country: hit.country as string,
      tripTitle: hit.tripTitle as string,
      url: hit.url as string,
      score: Math.round((hit.score as number) * 100) / 100,
    }));

  const text = hits.length
    ? hits.map((h) => `${h.date} · ${h.trip}/${h.slug} — ${h.title} (${h.location})`).join("\n")
    : `Nothing matched "${query}". Drafts are not searchable; list_drafts names them and get_day reads one.`;

  return { ok: true, text, data: { query, count: hits.length, results: hits } };
};

const listDraftsTool: Handler = (session, args) => {
  const requested = optionalString(args, "trip");
  let refs: string[];

  if (requested) {
    const trip = resolveTrip(session, args);
    if (!trip.ok) return trip;
    refs = [trip.ref];
  } else {
    refs = reachableTrips(session).map((t) => t.ref);
  }

  const drafts = refs.flatMap((ref) =>
    listDrafts(ref).map((d) => ({ ...d, trip: ref.slice(ref.indexOf("/") + 1) })),
  );

  const text = drafts.length
    ? drafts.map((d) => `${d.date} · ${d.trip}/${d.slug} — ${d.title}`).join("\n") +
      "\n\nEach of these is waiting for a person to publish it. Tell them what is here " +
      "and ask which they want on the site; `publish_day` is the tool that acts on the " +
      "answer. Do not call it for anything they have not said yes to."
    : "Nothing is waiting for review.";

  return { ok: true, text, data: { user: session.owner, drafts } };
};

/**
 * Write a day. Always a draft.
 *
 * There is no argument here that publishes, and there is no second tool that
 * does. Removing `status: draft` is a person's edit to a file, on purpose:
 * one invented memory in front of somebody's family is not recoverable, and no
 * amount of care in a prompt is a control.
 */
/**
 * Photographs, over the protocol.
 *
 * Base64 in JSON-RPC costs a third more bytes than the file itself, so this
 * is for a handful of pictures rather than a card full: the REST endpoint at
 * `POST /api/v1/<user>/trips/<trip>/media` takes multipart and is what an
 * agent with real volume should use. Both write the same two files — a
 * resized derivative for the browser and the untouched original for print.
 */
/**
 * Delete a draft, at the second time of asking.
 *
 * The refusal comes back as tool *output* rather than a protocol error, so the
 * agent reads the sentence and the code instead of seeing a transport failure
 * it might retry blindly.
 */
const deleteDayTool: Handler = (session, args) => {
  const trip = resolveTrip(session, args);
  if (!trip.ok) return trip;

  const slug = optionalString(args, "slug");
  if (!slug) return { ok: false, error: "slug is required — the day to delete" };

  // Two verbs, two signatures — see the route handler for why a code that
  // removes a draft must not remove something people have read.
  const published = isPublished(trip.ref, slug);
  const operation = {
    action: published ? ("delete_published" as const) : ("delete_draft" as const),
    scope: trip.ref,
    target: slug,
  };
  const confirm = optionalString(args, "confirm");
  if (!confirmationMatches(confirm, operation)) {
    const body = confirmationRequired(
      operation,
      published
        ? `This permanently deletes "${slug}", which is PUBLISHED — people may already ` +
            `have read it, and it cannot be undone from here.`
        : `This permanently deletes the draft "${slug}".`,
    );
    return { ok: false, error: `${body.message}\n\nconfirm: ${body.confirm}` };
  }

  const result = deleteEntry(trip.ref, slug, { allowPublished: true });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    text: `Deleted ${result.published ? "the published day" : "the draft"} ${slug}.`,
    data: { slug, deleted: true, published: result.published },
  };
};

/**
 * What was stored untouched, in a sentence.
 *
 * The tool's reply reports the derivative's dimensions, and the guide promises
 * a photobook is printed from the original — so an agent that sent 3000px and
 * read 2000px back concluded the original had been discarded. It had not. This
 * says so with the numbers it actually sent.
 */
function keptSummary(kept: KeptOriginal[]): string {
  const sized = kept.filter((k) => k.width && k.height);
  const shown = sized
    .slice(0, 3)
    .map((k) => `${k.filename} at ${k.width}×${k.height}`)
    .join(", ");
  const rest = sized.length > 3 ? `, and ${sized.length - 3} more` : "";
  return sized.length > 0
    ? `The originals are kept untouched — ${shown}${rest} — and the photobook prints from ` +
        `those, not from the resized copies the site serves.`
    : "The originals are kept untouched, and the photobook prints from those.";
}

/**
 * Put a draft on the site — the other half of the draft rule.
 *
 * The rule was always "an agent writes drafts, a person publishes them", and
 * the second half had no mechanism at either door: over MCP, as over REST, a
 * finished piece of work had nowhere to go. See the route handler for what
 * this does and does not guarantee.
 *
 * Owner only, and confirmed. A trip-scoped session writes days and cannot
 * publish them: being on the trip is not the same as deciding what the journal
 * says.
 */
const publishDayTool: Handler = (session, args) => {
  const trip = resolveTrip(session, args);
  if (!trip.ok) return trip;

  const slug = optionalString(args, "slug");
  if (!slug) return { ok: false, error: "slug is required — the draft to publish" };

  if (session.scope !== SESSION_SCOPE.agent) {
    return {
      ok: false,
      error:
        "This token is scoped to one trip, so it can write days into that trip but cannot " +
        "publish them. Only the journal's owner decides what goes on the site.",
    };
  }

  const entry = getEntryBySlug(trip.ref, slug, { includeDrafts: true });
  if (!entry) return { ok: false, error: `unknown_day: no entry "${slug}" in ${trip.ref}` };
  if (!entry.draft) return { ok: false, error: `"${slug}" is already on the site.` };

  const operation = { action: "publish_day" as const, scope: trip.ref, target: slug };
  const confirm = optionalString(args, "confirm");
  if (!confirmationMatches(confirm, operation)) {
    const body = confirmationRequired(
      operation,
      `This publishes "${entry.title}" (${entry.date}). It goes into the journal, the feed ` +
        `and the search index, and anyone with the link can read it. Taking it down again ` +
        `removes it from the site, not from the people who have already read it.`,
    );
    return { ok: false, error: `${body.message}\n\nconfirm: ${body.confirm}` };
  }

  const result = publishDraft(trip.ref, slug);
  if (!result.ok) return { ok: false, error: result.error };

  const base = serverSite().url;
  const [username, tripId] = trip.ref.split("/");
  return {
    ok: true,
    text:
      `Published "${entry.title}". It is on the site at ` +
      `${base}/${username}/trips/${tripId}/day/${slug} — tell the person, and give them ` +
      `the link.`,
    data: { slug, status: "published" },
  };
};

const addMedia: Handler = async (session, args) => {
  const trip = resolveTrip(session, args);
  if (!trip.ok) return trip;

  const day = optionalString(args, "day");
  if (!day) return { ok: false, error: "day is required — the day slug the photographs belong to" };

  // The same line the REST route draws, and for the same reason: these are
  // added to the day, and adding photographs to a day people have already read
  // changes what they read.
  if (isPublished(trip.ref, day)) {
    return {
      ok: false,
      error:
        `"${day}" is published, so this would change a day people have already read. ` +
        `Ask the person to add these themselves, or write a new day for them.`,
    };
  }

  const raw = Array.isArray(args.files) ? args.files : [];
  const urls = Array.isArray(args.urls) ? args.urls.filter((u): u is string => typeof u === "string") : [];
  if (raw.length === 0 && urls.length === 0) {
    return { ok: false, error: "send either files (filename + base64) or urls (https)" };
  }

  const uploads: UploadCandidate[] = [];

  // URLs are fetched by this server, which is why they are checked as
  // carefully as they are — see lib/api/fetchMedia.ts.
  if (urls.length > 0) {
    const limits = getUser(session.owner)!.media;
    for (const url of urls.slice(0, limits.itemsPerDay)) {
      const got = await fetchImage(url, limits.imageBytes);
      if (!got.ok) return { ok: false, error: `${got.problem.url} ${got.problem.reason}` };
      uploads.push(got.media);
    }
  }

  for (const [i, item] of raw.entries()) {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const filename = typeof entry.filename === "string" ? entry.filename : "";
    const base64 = typeof entry.base64 === "string" ? entry.base64 : "";
    if (!filename || !base64) {
      return { ok: false, error: `files[${i}] needs a filename and base64 contents` };
    }
    uploads.push({ filename, bytes: Buffer.from(base64, "base64") });
  }

  const result = await storeUploads(trip.ref, day, uploads);
  if (!result.ok) {
    return { ok: false, error: `invalid_media — ${describeProblems(result.problems)}` };
  }

  // Written into the day itself, rather than handed back to paste. There was
  // nothing to paste with: a day has no PATCH over either door, so a day
  // written before its photographs kept an empty gallery for ever.
  const attached = attachGallery(trip.ref, day, result.items);

  return {
    ok: true,
    text: attached.ok
      ? `Wrote ${result.items.length} file(s) and added them to ${day}. Nothing to paste — ` +
        `read the day back to see them. ${keptSummary(result.kept)}`
      : `Wrote ${result.items.length} file(s) to ${day}, but could not add them to the entry: ` +
        `${attached.error}`,
    data: { day, items: result.items, kept: result.kept, attached: attached.ok },
  };
};

const createDay: Handler = (session, args) => {
  const trip = resolveTrip(session, args);
  if (!trip.ok) return trip;

  const supplied = optionalString(args, "idempotency_key");
  const key = supplied ? idempotencyKey(session.owner, "create_day", supplied) : null;

  // The key is bound to what is being written, not just to the caller. A key
  // that comes back with different arguments is not a retry — it is a second
  // day wearing the first one's name — and answering it with the first day's
  // result would throw away what the agent just composed while telling it that
  // it had succeeded.
  const fingerprint = fingerprintOf(args);
  const previous = recall<ToolOutcome & { ok: true }>(key, fingerprint);

  if (previous.kind === "conflict") {
    return {
      ok: false,
      error:
        `idempotency_key ${JSON.stringify(supplied)} was already used for a different day, ` +
        "so nothing was written. The key identifies one write, not your session: reuse it " +
        "only to retry the *same* call after a dropped connection. For a new day, send a new key.",
    };
  }

  if (previous.kind === "replay") {
    return {
      ok: true,
      text:
        previous.value.text +
        "\n\n(Replayed: this idempotency_key was already used for this same call, and nothing was written again.)",
      data: { ...previous.value.data, replayed: true },
    };
  }

  const input: Partial<DraftInput> = {
    title: optionalString(args, "title"),
    date: optionalString(args, "date"),
    time: optionalString(args, "time"),
    location: optionalString(args, "location"),
    country: optionalString(args, "country"),
    content: optionalString(args, "content"),
  };
  for (const key2 of ["lat", "lng"] as const) {
    const value = args[key2];
    if (value !== undefined && value !== null) input[key2] = value as number;
  }
  if (Array.isArray(args.tags)) input.tags = args.tags.map(String);

  const problems = validateEntry(input);
  if (problems.length > 0) {
    return { ok: false, error: `invalid_entry — ${describeProblems(problems)}` };
  }

  const result = createDraft(trip.ref, input as DraftInput);
  if (!result.ok) return { ok: false, error: result.error };

  const outcome: ToolOutcome & { ok: true } = {
    ok: true,
    text:
      `Created ${result.slug} as a draft in ${trip.ref}.\n` +
      "It is not on the site. A person publishes it by removing the `status: draft` " +
      "line from the file — there is no tool, argument or flag here that does.",
    data: { trip: trip.ref, slug: result.slug, status: result.status, replayed: false },
  };
  remember(key, fingerprint, outcome);
  return outcome;
};

const createJournalTool: Handler = (session, args) => {
  // Only a signup session, and this is the check that keeps the MCP exception
  // from widening: an agent token for one journal must not be able to mint
  // more beside it.
  if (session.owner !== SIGNUP_OWNER) {
    return {
      ok: false,
      error:
        "This token belongs to a journal, so it cannot create another. Journals are created " +
        "with a signup token — start at POST /api/auth/signup/request.",
    };
  }

  const username = optionalString(args, "username");
  const title = optionalString(args, "title");
  const ownerName = optionalString(args, "owner_name");
  const ownerNickname = optionalString(args, "owner_nickname");
  if (!username || !title || !ownerName || !ownerNickname) {
    return {
      ok: false,
      error: "username, title, owner_name and owner_nickname are all required.",
    };
  }

  const created = createJournal({
    username,
    title,
    tagline: optionalString(args, "tagline"),
    ownerEmail: session.email,
    ownerName,
    ownerNickname,
    startLocation: optionalString(args, "start_location"),
    defaultLocale: optionalString(args, "default_locale"),
    baseCurrency: optionalString(args, "base_currency"),
  });
  if (!created.ok) return { ok: false, error: created.message };

  const base = serverSite().url;
  return {
    ok: true,
    text:
      `Created the journal "${created.username}" at ${base}/${created.username}, owned by ` +
      `${session.email}.\n\nIt has no trips yet. Ask for an agent token for it — ` +
      `POST /api/auth/request with {"user": "${created.username}", "email": "${session.email}", ` +
      `"kind": "agent"} — and then create a trip.`,
    data: {
      user: created.username,
      url: `${base}/${created.username}`,
      documentation: `${base}/${created.username}/documentation.txt`,
    },
  };
};

const createTripTool: Handler = (session, args) => {
  if (session.owner === SIGNUP_OWNER) {
    return { ok: false, error: "Create a journal first, then get an agent token for it." };
  }
  if (session.scope !== SESSION_SCOPE.agent) {
    return {
      ok: false,
      error:
        "This token is scoped to one trip, so it can write days into that trip but cannot " +
        "create new ones. Only the journal's owner can create a trip.",
    };
  }

  const id = optionalString(args, "id");
  const title = optionalString(args, "title");
  const start = optionalString(args, "start");
  const end = optionalString(args, "end");
  if (!id || !title || !start || !end) {
    return {
      ok: false,
      error:
        "id, title, start and end are all required. A trip without both dates is skipped " +
        "when the site reads it, so it would exist on disk and nowhere a reader could find it.",
    };
  }

  const created = createTrip(session.owner, {
    id,
    title,
    start,
    end,
    tagline: optionalString(args, "tagline"),
    status: optionalString(args, "status") as never,
    accent: optionalString(args, "accent") as never,
    visibility: optionalString(args, "visibility") as never,
    intro: optionalString(args, "intro"),
  });
  if (!created.ok) return { ok: false, error: created.message };

  const trip = getTrip(created.ref);
  const visibility = trip?.visibility ?? "private";
  return {
    ok: true,
    text:
      `Created the trip "${created.id}" in ${session.owner}, ${visibility}.` +
      (visibility === "private"
        ? ' Nobody but the owner can read it yet — say visibility "public" when it is ready, ' +
          "or ask the owner to."
        : "") +
      `\n\nWrite its first day with create_day, trip "${created.id}". Days arrive as drafts.`,
    data: { trip: created.id, ref: created.ref, visibility },
  };
};

/**
 * Ask to delete a trip, or the whole journal. **Neither deletes anything.**
 *
 * The other destructive tool here, `delete_day`, is finished by the agent: it
 * is refused once, hands back a code, and the agent repeats the call. That is
 * the right shape for a draft and the wrong shape for a journal, because the
 * agent can complete both halves on its own — see `lib/deletions.ts`.
 *
 * So these two answer with a *sentence about a mail*, not a result. An agent
 * that reports "deleted" here has said something false, and the text it reads
 * back says so before it says anything else.
 */
const requestDeletionTool =
  (kind: "journal" | "trip"): Handler =>
  async (session, args) => {
    if (session.owner === SIGNUP_OWNER) {
      return { ok: false, error: "This token belongs to no journal, so there is nothing to delete." };
    }
    // The owner, and nobody else. A `write:trip:<id>` token — what somebody
    // listed in a trip's people: block holds — may write days into that trip
    // and may not remove it. Writing to a journey and ending it are different
    // authorities.
    if (session.scope !== SESSION_SCOPE.agent) {
      return {
        ok: false,
        error:
          "This token is scoped to one trip, so it can write days into that trip but cannot " +
          "delete it, or the journal around it. Only the journal's owner can.",
      };
    }

    const tripId = optionalString(args, "trip");
    if (kind === "trip" && !tripId) {
      return { ok: false, error: "trip is required — the id of the journey to delete." };
    }

    const asked = await requestDeletion(
      kind === "trip"
        ? { kind, username: session.owner, tripId: tripId! }
        : { kind, username: session.owner },
      { sessionId: session.id },
    );
    if (!asked.ok) return { ok: false, error: asked.message };

    const { summary } = asked;
    const what =
      kind === "journal"
        ? `${summary.trips} journeys, ${summary.days} days and ${summary.files} files (${humanBytes(summary.bytes)})`
        : `${summary.days} days and ${summary.files} files (${humanBytes(summary.bytes)}), photographs included`;

    return {
      ok: true,
      text:
        `NOTHING HAS BEEN DELETED. "${summary.title}" is still there.\n\n` +
        `A mail has gone to ${asked.email}, the address that owns this journal, with a link ` +
        `to a page that names what would go — ${what} — and has a button on it. The link ` +
        `works for ${DELETION_TTL_MINUTES} minutes and once only, and you cannot follow it: ` +
        `this step exists so that a person, not an agent, ends a journal.\n\n` +
        `Tell them the mail is waiting. Do not report this as done.`,
      data: {
        deleted: false,
        status: "confirmation_sent",
        mailedTo: asked.email,
        expires: asked.expiresAt,
        willDelete: {
          title: summary.title,
          ...(kind === "trip" ? { trip: tripId, mediaGoesToo: true } : { trips: summary.trips }),
          days: summary.days,
          files: summary.files,
          size: humanBytes(summary.bytes),
        },
      },
    };
  };

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS: readonly (ToolDefinition & { handler: Handler })[] = [
  {
    name: "list_trips",
    title: "List trips",
    description:
      "Every trip in this journal, including ones the public cannot see. Start here: " +
      "the `id` of each trip is what every other tool wants.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    handler: listTrips,
  },
  {
    name: "get_day",
    title: "Read a day",
    description:
      "One day, as the markdown that produced it — drafts included, so you can read " +
      "back what you have just written before telling anyone it is ready. The reply " +
      "says whether it is a draft. Read a neighbouring day before writing one: you " +
      "are matching a voice, a language and a length.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Trip id, as list_trips reports it." },
        slug: { type: "string", description: "The day's slug." },
      },
      required: ["trip", "slug"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    handler: getDay,
  },
  {
    name: "search_entries",
    title: "Search entries",
    description:
      "Full-text search across every published entry in this journal, private trips " +
      "included. Drafts are not indexed — list_drafts names them and get_day reads them.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for. Prefix and fuzzy matching are on." },
        limit: { type: "integer", description: "Maximum results, 1-50. Default 10.", minimum: 1, maximum: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    handler: searchEntries,
  },
  {
    name: "list_drafts",
    title: "List drafts",
    description:
      "Everything waiting for a person to publish it. Useful for telling the author " +
      "what is outstanding.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Optional trip id. Omit for every trip in the journal." },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    handler: listDraftsTool,
  },
  {
    name: "create_journal",
    title: "Create a journal",
    description:
      "Create a new travel journal — a blog of its own, at /<username>, owned by the address " +
      "that verified the signup code. This is the only tool a signup token can call, and it " +
      "is the first step for somebody who has no journal yet. Ask the person for the username " +
      "they want rather than inventing one: it becomes the address of their site and cannot " +
      "be changed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description:
            "The address of the journal: lowercase letters, digits and dashes. Permanent.",
        },
        title: { type: "string", description: "What the journal is called." },
        tagline: { type: "string", description: "One line under the title. Optional — leave it out rather than inventing one." },
        owner_name: { type: "string", description: "The traveller's name. Required — ask for it." },
        owner_nickname: {
          type: "string",
          description:
            "What the site calls them, in its own voice — not necessarily their first name. " +
            "Required, and never guessed from owner_name: ask the person rather than splitting it.",
        },
        start_location: { type: "string", description: "Where they usually set out from." },
        default_locale: { type: "string", description: "Language code, e.g. en or de. Default en." },
        base_currency: { type: "string", description: "Currency costs are kept in. Default CHF." },
      },
      required: ["username", "title", "owner_name", "owner_nickname"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: createJournalTool,
  },
  {
    name: "create_trip",
    title: "Create a trip",
    description:
      "Create a trip in this journal, so there is somewhere to write days into. Needs a start " +
      "and an end date — a trip without both is skipped when the site reads it. Created " +
      "PRIVATE unless you are told otherwise: publishing somebody's journey is their decision, " +
      "not a default. Only the journal's owner can call this.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "URL segment: lowercase letters, digits and dashes. `japan-2027` ages better than `the-big-one`.",
        },
        title: { type: "string", description: "What the trip is called." },
        start: { type: "string", description: "First day, as 2027-04-01. Required." },
        end: { type: "string", description: "Last day, as 2027-05-15. Required." },
        tagline: { type: "string", description: "One line under the title. Optional." },
        status: { type: "string", enum: ["upcoming", "current", "past"], description: "Default upcoming. Exactly one trip should be `current`; it is the one served at the bare /<user> URL." },
        accent: { type: "string", enum: ["sky", "yellow", "green", "coral", "navy"], description: "Colour. Default sky." },
        visibility: { type: "string", enum: ["private", "public", "guest"], description: "Who is let in. Default private." },
        intro: { type: "string", description: "A paragraph introducing the trip. Only what you were told." },
      },
      required: ["id", "title", "start", "end"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: createTripTool,
  },
  {
    name: "create_day",
    title: "Write a day (as a draft)",
    description:
      "Write one day of a trip. It is created as a DRAFT and is not on the site: a " +
      "person publishes it, and there is no argument here that skips that. Write only " +
      "what you were told — no weather nobody mentioned, no meals nobody ate. An empty " +
      "field is better than an invented one. Pass idempotency_key so a retry does not " +
      "read as a conflict.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Trip id, as list_trips reports it." },
        title: { type: "string", description: "The day's title. Becomes the slug." },
        date: { type: "string", description: "YYYY-MM-DD." },
        time: { type: "string", description: "HH:MM. Orders several updates within one day." },
        location: { type: "string", description: "Place name. Leave empty rather than guessing." },
        country: { type: "string" },
        lat: { type: "number" },
        lng: { type: "number" },
        content: { type: "string", description: "The entry itself, in markdown." },
        tags: { type: "array", items: { type: "string" } },
        idempotency_key: {
          type: "string",
          description:
            "Any stable string of your choosing. Repeating a call with the same key " +
            "returns the first result instead of writing again.",
        },
      },
      required: ["trip", "title", "date", "content"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // It cannot overwrite and cannot publish; the worst it does is add a file
      // a person has not approved.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: createDay,
  },
  {
    name: "add_media",
    title: "Add photographs to a day",
    description:
      "Upload photographs to a day of a trip. They are added to that day's entry for " +
      "you — there is nothing to paste, and the order you write the day and send its " +
      "pictures in does not matter. Send the LARGEST file you have: the site is served a resized " +
      "copy, and the original you send is what a printed photobook is made from — it " +
      "cannot be recovered later. Accepts JPEG, PNG, HEIC/HEIF and WebP. Base64 costs " +
      "a third more than the file itself, so for more than a handful use the REST " +
      "endpoint POST /api/v1/<user>/trips/<trip>/media, which takes multipart. You can " +
      "instead pass `urls` and this server will download them: https only, and it will " +
      "refuse anything that resolves to a private address.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Trip id, as list_trips reports it." },
        day: {
          type: "string",
          description: "The day slug these belong to, e.g. \"lanterns-of-hoi-an\".",
        },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filename: { type: "string", description: "Original filename, for its extension." },
              base64: { type: "string", description: "The file's bytes, base64 encoded." },
            },
            required: ["filename", "base64"],
            additionalProperties: false,
          },
        },
        urls: {
          type: "array",
          items: { type: "string" },
          description:
            "https URLs for this server to download instead of sending bytes. Public " +
            "hosts only.",
        },
      },
      required: ["trip", "day"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // It only ever adds numbered files to a day's folder — the next free
      // index, never an existing one — so nothing it writes replaces anything.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: addMedia,
  },
  {
    name: "publish_day",
    title: "Publish a draft (needs confirming)",
    description:
      "Put a draft on the site. This is the step the draft rule reserves for a person — so " +
      "ask them first, in words, and do not call this because the day looks finished to " +
      "you. The first call is ALWAYS refused and hands you a confirmation code; repeat it " +
      "with `confirm` set to that value. Only the journal's owner can publish: a token " +
      "scoped to one trip writes days and cannot put them on the site. Publishing cannot " +
      "really be undone — taking a day down removes it from the journal, not from the " +
      "people who have already read it.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Trip id, as list_trips reports it." },
        slug: { type: "string", description: "The draft's slug, as list_drafts reports it." },
        confirm: {
          type: "string",
          description: "The code from the refusal. Do not invent one; it will not verify.",
        },
      },
      required: ["trip", "slug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // Not destructive — it creates nothing and removes nothing — but it is
      // not reversible either, and a client that treats it as safe would be
      // wrong in the way that matters.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: publishDayTool,
  },
  {
    name: "delete_day",
    title: "Delete a day (needs confirming)",
    description:
      "Delete a day. The first call is ALWAYS refused and hands you a confirmation code; " +
      "repeat the call with `confirm` set to it. Before you do: did the person ask you to " +
      "delete this? If you are not certain, ask them rather than confirming. A PUBLISHED " +
      "day needs its own confirmation — a code for a draft will not remove one — and " +
      "deleting it is irreversible: people may already have read it.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Trip id, as list_trips reports it." },
        slug: { type: "string", description: "The day's slug, as list_drafts or get_day reports it." },
        confirm: {
          type: "string",
          description: "The code from the refusal. Do not invent one; it will not verify.",
        },
      },
      required: ["trip", "slug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: deleteDayTool,
  },
  {
    name: "delete_trip",
    title: "Ask to delete a journey (the owner confirms by mail)",
    description:
      "Ask to delete a whole journey — its days, its costs, its plan and ITS PHOTOGRAPHS. " +
      "This does not delete anything: the server mails the journal's owner a link to a page " +
      "with a button, and only that button deletes. You cannot follow the link and must not " +
      "try. Report that a mail is waiting, never that the journey is gone. Note the " +
      "difference from delete_day, which leaves photographs on disk — a journey takes them " +
      "with it.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Trip id, as list_trips reports it." },
      },
      required: ["trip"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // False: this call writes a request and sends a mail, and nothing else.
      // Saying `true` here would invite a client to treat it as the deletion.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: requestDeletionTool("trip"),
  },
  {
    name: "delete_journal",
    title: "Ask to delete the whole journal (the owner confirms by mail)",
    description:
      "Ask to delete this entire journal — every journey, every day, every photograph, and " +
      "the address itself, which is never given out again. This does not delete anything: " +
      "the server mails the owner a link to a page with a button, and only that button " +
      "deletes. You cannot follow the link. Ask the person twice before calling this, and " +
      "report that a mail is waiting rather than that the journal is gone.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: requestDeletionTool("journal"),
  },
] as const;

/**
 * The tools this session may actually call.
 *
 * A signup token proves an address and nothing else — there is no journal for
 * it to read or write. Listing the rest would be an invitation to call them
 * and get an error, so it sees one tool and `callTool` enforces the same list.
 */
export function toolsFor(session: Session): readonly (ToolDefinition & { handler: Handler })[] {
  return session.owner === SIGNUP_OWNER
    ? TOOLS.filter((t) => t.name === "create_journal")
    : TOOLS.filter((t) => t.name !== "create_journal");
}

/** The wire shape, with the handler left behind. Written out field by field so
 * that adding a field to the registry cannot leak it into the protocol. */
export function toolDefinitions(session?: Session): ToolDefinition[] {
  return (session ? toolsFor(session) : TOOLS).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}

export async function callTool(
  name: string,
  session: Session,
  args: Args,
): Promise<ToolOutcome | null> {
  const tool = toolsFor(session).find((t) => t.name === name);
  if (!tool) return null;
  return tool.handler(session, args);
}
