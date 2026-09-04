import "server-only";
import MiniSearch from "minisearch";
import { LOCALE_LIST } from "../api/agentCopy";
import { SESSION_SCOPE, SIGNUP_OWNER, type Session } from "../auth";
import { MAINTAINED_LOCALES } from "../i18n";
import type { Trip } from "../types";
import { attachGallery, createDraft, deleteEntry, editEntry, entrySummary, isPublished, listDrafts, publishNotice, publishDraft, tripSummary, type DraftInput, type EditInput } from "../api/entries";
import { isTestContent } from "../access";
import { getAllEntries, getEntryBySlug } from "../entries";
import { stripMarkdown } from "../markdownText";
import { SEARCH_OPTIONS, type SearchDoc } from "../searchOptions";
import { getMalformedTrips, getTrip, getTrips, MAX_TRIP_PEOPLE, tripRef } from "../trips";
import { tripWriteVerdict } from "../tripPeople";
import { validateEntry, validateEntryEdit, type Problem } from "../validate/entry";
import {
  createJournal,
  JOURNAL_PROFILE_FIELDS,
  setJournalFeatures,
  setJournalProfile,
} from "../journals";
import { createTrip } from "../tripWrite";
import { serverSite } from "../site";
import { storeUploads, type KeptOriginal, type UploadCandidate } from "../api/media";
import { fetchImage } from "../api/fetchMedia";
import { getUser } from "../users";
import { confirmationMatches, confirmationRequired } from "../agentConfirm";
import { isEnabled } from "../capabilities";
import type { FeatureName } from "../config";
import {
  createInvite,
  inviteExpiry,
  inviteLinkUrl,
  listInvites,
  revokeInvite,
} from "../contacts/invites";
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
 * Allowed to be async because some of them do work off-thread: `add_media`
 * decodes and resizes a photograph through sharp, and since B98 every handler
 * that names a trip asks the database whether the session may still write to
 * it. `callTool` awaits regardless, so a handler's own shape is nobody else's
 * problem.
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
async function resolveTrip(
  session: Session,
  args: Args,
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
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
  //
  // Somebody who *was* on it and has been removed is told so instead (B98).
  // They already know the trip exists — their token names it — so the reason
  // gives nothing away, and "unknown trip" would send them off to re-check an
  // id that was right all along.
  switch (await tripWriteVerdict(session.scope, session.email, trip)) {
    case "allowed":
      return { ok: true, ref };
    case "revoked":
      return {
        ok: false,
        error:
          `access_revoked: your access to "${raw}" has been withdrawn by the journal's owner. ` +
          `This token can no longer write to it, and a new one will not be issued — ask them directly.`,
      };
    default:
      return { ok: false, error: `unknown_trip: no trip "${raw}" in ${session.owner}` };
  }
}

/** The trips this session may act on — the whole journal, or the one trip. */
async function reachableTrips(session: Session) {
  const trips = getTrips(session.owner);
  const verdicts = await Promise.all(
    trips.map((trip) => tripWriteVerdict(session.scope, session.email, trip)),
  );
  return trips.filter((_, at) => verdicts[at] === "allowed");
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * The searchable corpus for one journal.
 *
 * Deliberately wider than `/<user>/search-index.json`, which only indexes trips
 * the public may see. The caller here holds a token for this journal, so their
 * own unlisted and closed trips are theirs to search. Drafts are
 * still absent, because `getAllEntries` filters them — a draft is found through
 * `list_drafts`, which is the tool that says what it is.
 *
 * **Content nobody lived is in it, and says so.** B158 left that undecided; the
 * decision is that an agent searching the journal it is working in wants to
 * find its own test days — otherwise the one kind of content an agent is
 * allowed to invent is the one kind it cannot look up afterwards, and the
 * public index it would be matching (`lib/search.ts`) is a different corpus
 * with a different purpose. So this is the same split B116 settled for
 * `list_trips`: the structured surface is wider than the public one, and every
 * result that is fiction is marked as fiction — in the text as well as the
 * data, since a caller reading only `text` is the failure B116 fixed.
 *
 * `test` is returned beside the documents rather than inside them: `SearchDoc`
 * is shared with the browser's index through `SEARCH_OPTIONS.storeFields`, and
 * adding a field there would change the shape of a static asset that never
 * carries a test day in the first place.
 */
function searchDocs(
  username: string,
  trips: Trip[],
): { docs: SearchDoc[]; invented: Set<string> } {
  const docs: SearchDoc[] = [];
  const invented = new Set<string>();
  for (const trip of trips) {
    for (const entry of getAllEntries(trip.ref)) {
      const id = `${trip.id}/${entry.slug}`;
      // The trip's flag counts, not only the day's — a day inside a `test`
      // trip carries nothing of its own.
      if (isTestContent(trip, entry)) invented.add(id);
      docs.push({
        id,
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
  return { docs, invented };
}

/** One line per problem — a tool error is plain text, so the list has to read
 * on its own rather than lean on the JSON structure the REST route's
 * `{ error, problems }` body can. */
function describeProblems(problems: Problem[]): string {
  return problems.map((p) => `${p.field}: got ${p.got}, expected ${p.expected}`).join("; ");
}

/**
 * The sentence that says this is content nobody lived — written once.
 *
 * `get_day` has said it in its text block since B47; `list_trips` said it only
 * in `structuredContent`, so an agent reading the summary — which is the
 * channel the format exists to be read through — saw a trip that looked lived
 * (B116). Both now render this, and the noun is the only thing that varies:
 * one sentence appearing in two forms is the thing that drifts, and this is
 * the one sentence the whole convention rests on.
 */
function testContentNotice(subject: "day" | "trip"): string {
  return `**Test content — this ${subject} did not happen.** It exists to check the software.`;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const listTrips: Handler = async (session) => {
  const trips = (await reachableTrips(session))
    .map((trip) => tripSummary(session.owner, trip.id))
    .filter((t): t is NonNullable<typeof t> => t !== null);

  /*
   * Trips on disk that will not load (B83). The REST list already reports
   * these; an agent working over MCP was the one caller still being told the
   * folder simply was not there. Owner-scoped tokens only, matching that route
   * and `reachableTrips` above — a token for one trip learns nothing about the
   * rest of the journal, malformed or not.
   */
  const malformed =
    session.scope === SESSION_SCOPE.agent ? getMalformedTrips(session.owner) : [];

  const listed = trips.length
    ? trips
        .map(
          (t) =>
            `${t.id} — ${t.title} (${t.status}, ${t.start} to ${t.end}) · ` +
            `${t.entries} entries, ${t.drafts} draft${t.drafts === 1 ? "" : "s"}` +
            // Said in the text as well as the data, for the same reason
            // `get_day` says it: an agent summarising this list to a person
            // must not describe a trip nobody took as though it recorded
            // something. On the same line, so the format stays one line per
            // trip. B116.
            (t.test ? ` · ${testContentNotice("trip")}` : ""),
        )
        .join("\n")
    : "No trips yet in this journal.";

  // Said in the prose as well as the data. A tool result is read far more
  // often than it is parsed, and an agent that only reads `text` would
  // otherwise see the trip missing with no explanation — which is the whole
  // bug, one layer up.
  const text = malformed.length
    ? `${listed}\n\nNot loading — ${malformed.length} folder` +
      `${malformed.length === 1 ? "" : "s"} under trips/ with a broken trip.md:\n` +
      `${malformed.map((m) => `- ${m.folder}/trip.md: ${m.problem}`).join("\n")}\n\n` +
      "Fix the file named in each, then call list_trips again to confirm it loads."
    : listed;

  return {
    ok: true,
    text,
    // Absent when there are none, like every other flag here: a `"malformed":
    // []` on every reply reads as routine and stops being noticed.
    data: { user: session.owner, trips, ...(malformed.length ? { malformed } : {}) },
  };
};

const getDay: Handler = async (session, args) => {
  const trip = await resolveTrip(session, args);
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
    ...(entry.draft ? ["", "**Draft — not on the site.** `publish_day` puts it up, once they say so."] : []),
    // Said in the text as well as the data, for the same reason as the draft
    // line above: an agent summarising this must not describe a day nobody
    // lived as though it recorded something.
    ...(isTestContent(getTrip(trip.ref), entry) ? ["", testContentNotice("day")] : []),
    "",
    entry.content,
  ].join("\n");

  return {
    ok: true,
    text,
    data: {
      trip: trip.ref,
      // The trip, so `test` is inherited rather than read off the entry alone
      // — `entrySummary` decides it now, in one place for both doors (B116).
      ...entrySummary(entry, getTrip(trip.ref)),
      tags: entry.tags,
      costs: entry.costs,
      ...(entry.transport ? { transport: entry.transport } : {}),
      content: entry.content,
      status: entry.draft ? "draft" : "published",
    },
  };
};

const searchEntries: Handler = async (session, args) => {
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
  const { docs, invented } = searchDocs(session.owner, await reachableTrips(session));
  index.addAll(docs);

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
      // Only when true, like every other surface that reports this. B158.
      ...(invented.has(String(hit.id)) ? { test: true as const } : {}),
    }));

  const text = hits.length
    ? hits
        .map(
          (h) =>
            `${h.date} · ${h.trip}/${h.slug} — ${h.title} (${h.location})` +
            (h.test ? ` · ${testContentNotice("day")}` : ""),
        )
        .join("\n")
    : `Nothing matched "${query}". Drafts are not searchable; list_drafts names them and get_day reads one.`;

  return { ok: true, text, data: { query, count: hits.length, results: hits } };
};

const listDraftsTool: Handler = async (session, args) => {
  const requested = optionalString(args, "trip");
  let refs: string[];

  if (requested) {
    const trip = await resolveTrip(session, args);
    if (!trip.ok) return trip;
    refs = [trip.ref];
  } else {
    refs = (await reachableTrips(session)).map((t) => t.ref);
  }

  const drafts = refs.flatMap((ref) =>
    listDrafts(ref).map((d) => ({ ...d, trip: ref.slice(ref.indexOf("/") + 1) })),
  );

  const text = drafts.length
    ? drafts
        .map(
          (d) =>
            `${d.date} · ${d.trip}/${d.slug} — ${d.title}` +
            // The same sentence `get_day` and `list_trips` say, on the same
            // line so the format stays one line per draft. This list is read
            // out loud to a person at the moment they decide what goes on the
            // site, which makes it the worst place to leave the flag in the
            // data and out of the prose. B134.
            (d.test ? ` · ${testContentNotice("day")}` : ""),
        )
        .join("\n") +
      "\n\nEach of these is waiting to be read back. Tell them what is here and ask which " +
      "they want on the site; `publish_day` is the tool that acts on the answer. Do not " +
      "call it for anything they have not said yes to."
    : "Nothing is waiting for review.";

  return { ok: true, text, data: { user: session.owner, drafts } };
};

/**
 * Write a day. Always a draft.
 *
 * There is no argument here that publishes. `publish_day` is the second half,
 * and an agent holds both — the split is not a gate against it. What the gap
 * buys is a moment where the day exists and nobody has read it yet, which is
 * where the person reads it back. That is the only protection against an
 * invented memory reaching somebody's family, because no amount of care in a
 * prompt is a control.
 *
 * This comment said "there is no second tool that does" until B156. It was the
 * reasoning that kept the reply string below alive after B28 built the tool,
 * two entries away in the same `tools/list` response.
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
const deleteDayTool: Handler = async (session, args) => {
  const trip = await resolveTrip(session, args);
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
 * The links that let other people in — B33.
 *
 * **Owner only, and the refusal is the same shape as `publish_day`'s.** A
 * `write:trip:<id>` token belongs to somebody who came on one trip: they may
 * write days into it, and inviting other people to it is not the same
 * authority. Approving a buddy also lets that person read the journal's guest
 * trips, which is not a companion's to offer.
 */
function ownerOnly(session: Session, what: string): ToolOutcome | null {
  if (session.owner === SIGNUP_OWNER) {
    return { ok: false, error: "This token belongs to no journal yet." };
  }
  if (session.scope !== SESSION_SCOPE.agent) {
    return {
      ok: false,
      error:
        `This token is scoped to one trip, so it can write days into that trip but cannot ${what}. ` +
        "Only the journal's owner can invite people.",
    };
  }
  if (!isEnabled("contacts", session.owner)) {
    return {
      ok: false,
      error:
        "This journal does not have contacts switched on, so it has no queue for a " +
        "redemption to land in and no way to approve anybody.",
    };
  }
  return null;
}

const createInviteTool: Handler = async (session, args) => {
  const refused = ownerOnly(session, "hand out invitations");
  if (refused) return refused;

  const kind = optionalString(args, "kind");
  if (kind !== "guest" && kind !== "buddy") {
    return {
      ok: false,
      error:
        'kind must be "guest" (let somebody read the journal) or "buddy" (put somebody on ' +
        "one trip, which lets them write to it). Ask the person which they mean rather " +
        "than guessing: a buddy link grants write access and is not the one for a group chat.",
    };
  }

  let tripId: string | null = null;
  if (kind === "buddy") {
    const trip = await resolveTrip(session, args);
    if (!trip.ok) return trip;
    tripId = trip.ref.split("/")[1];
  } else if (optionalString(args, "trip")) {
    return {
      ok: false,
      error:
        "A guest link is journal-wide: being let in opens every trip marked " +
        '`visibility: guest` and never one marked `private`. There is no per-trip guest ' +
        "link. To hold one trip back from the people you have let in, mark it `private`.",
    };
  }

  const days = typeof args.days === "number" ? args.days : undefined;
  const created = await createInvite(session.owner, {
    kind,
    tripId,
    name: optionalString(args, "name"),
    locale: optionalString(args, "locale"),
    expiresAt: inviteExpiry(days),
  });
  const url = inviteLinkUrl(serverSite().url, session.owner, kind, created.token);

  return {
    ok: true,
    text:
      `${url}\n\n` +
      (kind === "buddy"
        ? `This puts somebody on "${tripId}". Following it does NOT let them in — they prove ` +
          "their address and land in the owner's queue, and the owner approves by hand. Once " +
          "approved they can write to that trip and read the journal's guest trips, so send " +
          "it only to the people who were actually there, never to a group chat."
        : "Safe to forward. Following it does NOT let anybody in — each person proves their " +
          "own address and the owner approves them by hand. It opens every trip marked " +
          "`guest`, and never a `private` one.") +
      `\n\nGive the person the link and say which kind it is. It expires ${created.expiresAt ? `on ${created.expiresAt.slice(0, 10)}` : "never"}, and can be revoked with revoke_invite (id ${created.id}).`,
    data: {
      id: created.id,
      kind,
      scope: tripId ? tripRef(session.owner, tripId) : session.owner,
      trip: tripId,
      url,
      expiresAt: created.expiresAt,
    },
  };
};

const listInvitesTool: Handler = async (session) => {
  const refused = ownerOnly(session, "list invitations");
  if (refused) return refused;

  const invites = await listInvites(session.owner);
  const now = new Date().toISOString();
  const rows = invites.map((invite) => ({
    id: invite.id,
    kind: invite.kind,
    scope: invite.tripId ? tripRef(session.owner, invite.tripId) : session.owner,
    name: invite.name,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    // Whether the link still opens anything, decided here rather than left to
    // the reader to derive from two nullable timestamps — B97 is the same
    // legibility failure in the owner's own browser.
    live: invite.revokedAt === null && (invite.expiresAt === null || invite.expiresAt > now),
    uses: invite.uses,
  }));
  return {
    ok: true,
    text:
      rows.length === 0
        ? "No invite links have been issued."
        : rows
            .map(
              (row) =>
                `${row.id} — ${row.kind} to ${row.scope}, used ${row.uses}×` +
                (row.revokedAt
                  ? ", revoked"
                  : !row.live && row.expiresAt
                    ? // Said as "expired" rather than "until <a date in the
                      // past>", which reads as a live link to anything
                      // skimming the line.
                      `, expired ${row.expiresAt.slice(0, 10)}`
                    : row.expiresAt
                      ? `, until ${row.expiresAt.slice(0, 10)}`
                      : ""),
            )
            .join("\n") +
          "\n\nA buddy link leads to write access on the trip it names; a guest or personal " +
          "link leads to reading. Neither grants anything until the owner approves whoever " +
          "redeems it.\n\nThe links themselves are not here and cannot be: only their hashes " +
          "were stored, so one that was lost has to be reissued rather than looked up.",
    data: { invites: rows },
  };
};

const revokeInviteTool: Handler = async (session, args) => {
  const refused = ownerOnly(session, "revoke invitations");
  if (refused) return refused;

  const id = optionalString(args, "id");
  if (!id) return { ok: false, error: "id is required — as list_invites reports it" };
  const invite = (await listInvites(session.owner)).find((row) => row.id === id);
  if (!invite) return { ok: false, error: `unknown_invite: no link "${id}" in ${session.owner}` };

  await revokeInvite(session.owner, id);
  return {
    ok: true,
    text:
      "The link stops working. Everybody already approved stays exactly where they are — " +
      "revoking a link takes nothing back from anybody who is already in.",
    data: { id, revoked: true },
  };
};

/**
 * Put a draft on the site — the other half of writing one.
 *
 * Until B28 the second half had no mechanism at either door: over MCP, as over
 * REST, a finished piece of work had nowhere to go. See the route handler for
 * what this does and does not guarantee, and for why the confirmation
 * handshake that used to sit here went away in B224.
 *
 * Owner only. A trip-scoped session writes days and cannot publish them: being
 * on the trip is not the same as deciding what the journal says.
 */
const publishDayTool: Handler = async (session, args) => {
  const trip = await resolveTrip(session, args);
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

  const result = publishDraft(trip.ref, slug);
  if (!result.ok) return { ok: false, error: result.error };

  const base = serverSite().url;
  const [username, tripId] = trip.ref.split("/");
  return {
    ok: true,
    text:
      `Published "${entry.title}". It is on the site at ` +
      `${base}/${username}/trips/${tripId}/day/${slug} — tell the person, and give them ` +
      `the link.\n\n` +
      // The same sentence the REST route reads out, from the same function —
      // and, since B158, one that describes the day in front of the person
      // rather than days in general. A `test: true` day is kept out of the
      // feed, the search index and the sitemap, and this used to promise all
      // three at the last moment anybody was listening. It was the refusal's
      // message until B224 and is the receipt now.
      publishNotice({
        title: entry.title,
        date: entry.date,
        url: `${base}/${username}`,
        test: isTestContent(getTrip(trip.ref), entry),
      }),
    data: { slug, status: "published" },
  };
};

const addMedia: Handler = async (session, args) => {
  const trip = await resolveTrip(session, args);
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

const createDay: Handler = async (session, args) => {
  const trip = await resolveTrip(session, args);
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
  // Only `true` is meaningful. `test: false` is the ordinary case and writing
  // it would put a line in the frontmatter of every real day — see the note on
  // NewTrip.test. B157: this door could not say it at all until now, so an
  // agent asked to invent one day inside a real trip had only the fallback
  // AGENTS.md names and rejects: writing "this is a test" into the prose.
  if (args.test === true) input.test = true;

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
      "It is not on the site yet. Read it back to them, and call `publish_day` when they " +
      "say so — not because the day looks finished to you.",
    data: { trip: trip.ref, slug: result.slug, status: result.status, replayed: false },
  };
  remember(key, fingerprint, outcome);
  return outcome;
};

/**
 * Edit a day that already exists — the other half of B266.
 *
 * REST and MCP are the same two doors onto the same markdown, and B263 was
 * exactly this shape of mistake fixed on one door and left standing on the
 * other. `additionalProperties: false` on this tool's schema already refuses
 * a `status` argument before `callTool` ever reaches this handler (see
 * `unknownProperties`), so there is nothing to check for it here — the same
 * structural guarantee `EditInput`'s type gives the REST route.
 *
 * Same fields this tool's own `create_day` accepts, minus `idempotency_key`:
 * `costs` and the transport fields are not exposed here because `create_day`
 * does not expose them either — this does not widen what MCP can write, only
 * what it can correct.
 */
const editDay: Handler = async (session, args) => {
  const trip = await resolveTrip(session, args);
  if (!trip.ok) return trip;

  const slug = optionalString(args, "slug");
  if (!slug) {
    return { ok: false, error: "slug is required — the day to edit, as list_drafts or get_day reports it" };
  }

  const input: EditInput = {};
  for (const key of ["title", "date", "time", "location", "country", "content"] as const) {
    const value = optionalString(args, key);
    if (value !== undefined) input[key] = value;
  }
  for (const key of ["lat", "lng"] as const) {
    const value = args[key];
    if (value !== undefined && value !== null) input[key] = value as number;
  }
  if (Array.isArray(args.tags)) input.tags = args.tags.map(String);
  if (typeof args.test === "boolean") input.test = args.test;

  if (Object.keys(input).length === 0) {
    return { ok: false, error: "nothing to change — send one or more fields to edit" };
  }

  const problems = validateEntryEdit(input);
  if (problems.length > 0) return { ok: false, error: `invalid_entry — ${describeProblems(problems)}` };

  const result = editEntry(trip.ref, slug, input);
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    text:
      `Edited ${result.slug} in ${trip.ref}. It is still ${result.status === "draft" ? "a draft" : "published"} ` +
      "— this call cannot move it between the two; publish_day is the only thing that does." +
      (result.status === "published"
        ? " Anyone who already read it can now see this change."
        : ""),
    data: { trip: trip.ref, slug: result.slug, status: result.status },
  };
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

  // Required rather than defaulted, the same as on the REST door — B263. A
  // journal asked to be private and created public because this tool asked
  // no question and `createJournal` filled the silence in with `public`.
  const visibility = optionalString(args, "visibility");
  if (visibility === undefined) {
    return {
      ok: false,
      error:
        'visibility is required — "public" or "private". There is no default worth ' +
        "picking for somebody: ask which they want.",
    };
  }
  if (visibility !== "public" && visibility !== "private") {
    return {
      ok: false,
      error: `visibility must be "public" or "private", got ${JSON.stringify(visibility)}.`,
    };
  }

  const defaultLocale = optionalString(args, "default_locale");
  if (defaultLocale === undefined) {
    return {
      ok: false,
      error:
        "default_locale is required — the language the owner writes in. It sets the " +
        "language of the site's own chrome and of the welcome mail. There is no default " +
        `worth picking for somebody: ask, and send the code — ${LOCALE_LIST}.`,
    };
  }
  if (!(MAINTAINED_LOCALES as readonly string[]).includes(defaultLocale)) {
    return {
      ok: false,
      error: `default_locale must be one of ${LOCALE_LIST}, got ${JSON.stringify(defaultLocale)}.`,
    };
  }

  const created = createJournal({
    username,
    title,
    tagline: optionalString(args, "tagline"),
    ownerEmail: session.email,
    ownerName,
    ownerNickname,
    visibility,
    startLocation: optionalString(args, "start_location"),
    defaultLocale,
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

/**
 * Switch a capability on or off for this journal — B182.
 *
 * The features block used to be written once, by `createJournal`, and then
 * frozen: nothing anywhere wrote it again, so a journal created before
 * contacts became a default had no way to reach them except a shell on the
 * server. The person this product is for has never seen the folder.
 *
 * Three things it will not do, and all three are deliberate:
 *
 * - It does not touch anything but `features`. Not the title, not the locales,
 *   and never `owner.email` — the address that decides who can obtain a token
 *   for this journal (decision 24). A token cannot move the boundary that
 *   issued it.
 * - It cannot widen past the server. `lib/capabilities.ts` treats the server's
 *   config as a ceiling, so this refuses rather than writing something inert.
 * - It publishes nothing and reads nothing new. Capabilities decide what a
 *   journal can *do*; who may read a trip is still the trip's own gate.
 */
const setJournalFeaturesTool: Handler = (session, args) => {
  if (session.owner === SIGNUP_OWNER) {
    return { ok: false, error: "Create a journal first, then get an agent token for it." };
  }
  if (session.scope !== SESSION_SCOPE.agent) {
    return {
      ok: false,
      error:
        "This token is scoped to one trip, so it can write days into that trip but cannot " +
        "change what the journal around it can do. Only the journal's owner can.",
    };
  }

  const features = args.features;
  if (typeof features !== "object" || features === null || Array.isArray(features)) {
    return {
      ok: false,
      error: 'features must be an object of capability names to true or false, e.g. {"contacts": true}.',
    };
  }

  const result = setJournalFeatures(session.owner, features as Record<string, unknown>);
  if (!result.ok) return { ok: false, error: result.message };

  const on = Object.entries(result.features)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  return {
    ok: true,
    text:
      (result.changed.length
        ? `Changed ${result.changed.join(", ")} for ${session.owner}.`
        : `Nothing changed — ${session.owner} already asked for exactly this.`) +
      `\n\nThis journal now asks for: ${on.length ? on.join(", ") : "nothing"}. What it ` +
      `actually gets is that list narrowed by what this server can provide — /api/health ` +
      `says which, and why anything is off.`,
    data: { user: session.owner, features: result.features, changed: result.changed },
  };
};

/**
 * Change what a journal says about itself — B220.
 *
 * The sibling of `set_journal_features`, and separate from it on purpose:
 * each call edits `config.json` whole, and one tool doing both would be one
 * call that can succeed halfway.
 *
 * What it will not touch is the interesting half, and `JOURNAL_FIELD_REFUSALS`
 * in lib/journals.ts carries the reason for each: `owner.email` (a token must
 * not move the boundary that issued it), `baseCurrency` (changing it re-reads
 * every cost already written rather than reconverting it) and `media` (the
 * server is already a ceiling over it).
 */
const setJournalProfileTool: Handler = (session, args) => {
  if (session.owner === SIGNUP_OWNER) {
    return { ok: false, error: "Create a journal first, then get an agent token for it." };
  }
  if (session.scope !== SESSION_SCOPE.agent) {
    return {
      ok: false,
      error:
        "This token is scoped to one trip, so it can write days into that trip but cannot " +
        "change what the journal around it says about itself. Only the journal's owner can.",
    };
  }

  // Only the keys the caller actually sent. An absent argument is "leave it
  // alone", and passing `undefined` through would make every call a change to
  // every field.
  const changes: Record<string, unknown> = {};
  for (const field of JOURNAL_PROFILE_FIELDS) {
    if (args[field] !== undefined) changes[field] = args[field];
  }

  const result = setJournalProfile(session.owner, changes);
  if (!result.ok) return { ok: false, error: result.message };

  return {
    ok: true,
    text:
      (result.changed.length
        ? `Changed ${result.changed.join(", ")} for ${session.owner}.`
        : `Nothing changed — ${session.owner} already said exactly this.`) +
      `\n\n"${result.journal.title}"${result.journal.tagline ? ` — ${result.journal.tagline}` : ""}, ` +
      `${result.journal.visibility}, in ${result.journal.locales.join(", ")}, ` +
      `budgeted in ${result.journal.baseCurrency}.` +
      (result.journal.visibility === "public"
        ? ""
        : " Unlisted: this server does not advertise it, though who may read a journey is " +
          "still that trip's own visibility."),
    data: { user: session.owner, journal: result.journal, changed: result.changed },
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
    // Raw rather than `optionalString`: `createTrip` refuses a value it does
    // not read instead of defaulting it, and a non-string would otherwise
    // arrive there as "not asked for" and quietly leave the money public.
    // B178.
    costsVisibility: (args.costsVisibility ?? undefined) as never,
    // Only a real boolean counts. `createTrip` refuses `listed: true` on a trip
    // no visibility advertises and writes `listed: false` when a public trip is
    // narrowed; anything else here means "not asked for", which is what leaves
    // an ordinary public trip advertised. REST has taken this since W27 and MCP
    // could not ask for it at all — the setting AGENTS.md calls the old
    // `unlisted`, and the honest one for a trip somebody mails to their family.
    // B175, and B206 is the same finding from the other side.
    listed: typeof args.listed === "boolean" ? args.listed : undefined,
    intro: optionalString(args, "intro"),
    // Inherited by every day of the trip, so somebody exercising the pipeline
    // sets it once. Same gap as create_day carried — B157.
    ...(args.test === true ? { test: true } : {}),
    // Raw, like `costsVisibility` above: `createTrip` validates all three and
    // names the entry and key that is wrong, which is what an agent needs to
    // fix a `people:` list. B207.
    people: args.people,
    rates: args.rates,
    translations: args.translations,
  });
  if (!created.ok) return { ok: false, error: created.message };

  const trip = getTrip(created.ref);
  const visibility = trip?.visibility ?? "private";
  // Read back off the trip rather than echoed from the argument: the caller
  // needs to see that what they asked for took, which for `listed` is the whole
  // point of asking. B51 made the key real everywhere else; B175 is the door
  // that could not reach it.
  const listed = trip?.listed ?? true;
  return {
    ok: true,
    text:
      `Created the trip "${created.id}" in ${session.owner}, ${visibility}.` +
      (visibility === "private"
        ? ' Nobody but the owner can read it yet — say visibility "public" when it is ready, ' +
          "or ask the owner to."
        : "") +
      (visibility === "public" && !listed
        ? " It is unlisted: anybody with the link can read it, and it is in no sitemap, feed " +
          "or trip switcher. That is the setting to hand out by message rather than publish."
        : "") +
      `\n\nWrite its first day with create_day, trip "${created.id}". Days arrive as drafts.`,
    data: { trip: created.id, ref: created.ref, visibility, listed },
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

/**
 * A tool, plus the two things the wire never sees: what runs it, and the
 * capability it needs.
 *
 * `requires` is the capability the *handler* already refuses without. Naming it
 * here keeps the two answers in one place — a tool whose handler checks a
 * feature and whose entry does not name it is a tool that will be advertised to
 * a journal that cannot call it, which is the bug B183 is (see `toolsFor`).
 */
type ToolEntry = ToolDefinition & { handler: Handler; requires?: FeatureName };

export const TOOLS: readonly ToolEntry[] = [
  {
    name: "list_trips",
    title: "List trips",
    description:
      "Every trip in this journal, including ones the public cannot see. Start here: " +
      "the `id` of each trip is what every other tool wants. If you have just written a " +
      "trip.md by hand, read this back — a folder whose frontmatter the site refused is " +
      "reported under `malformed`, with what is wrong with it, rather than silently missing.",
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
      "included. Drafts are not indexed — list_drafts names them and get_day reads them. " +
      "Days nobody lived ARE indexed here, unlike the journal's public search, and every " +
      "one of them says so in its line: this is your own journal, so your test content is " +
      "findable, but never repeat one to a person as something that happened.",
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
      "Everything written and not yet on the site. Useful for telling the author " +
      "what is outstanding. A draft nobody lived says so on its own line — read that " +
      "out with the rest, because it is what decides whether they want it on the site.",
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
        visibility: {
          type: "string",
          enum: ["public", "private"],
          description:
            "Whether this server advertises the journal — on its own index, its landing " +
            "page and its sitemap. Required; there is no default. Ask which they want.",
        },
        start_location: { type: "string", description: "Where they usually set out from." },
        default_locale: {
          type: "string",
          description:
            "Language code, e.g. en or de — the language the owner writes in. Sets the " +
            "site's chrome and the welcome mail. Required; there is no default. Ask.",
        },
        base_currency: { type: "string", description: "Currency costs are kept in. Default CHF." },
      },
      required: ["username", "title", "owner_name", "owner_nickname", "visibility", "default_locale"],
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
    name: "set_journal_features",
    title: "Switch a capability on or off for this journal",
    description:
      "Turn one of this journal's capabilities on or off — contacts, mail, reactions, costs, " +
      "push, signup, postcards, photobook. Until now a journal's capabilities were decided " +
      "when it was created and could only be changed by editing a file on the server, which " +
      "left journals unable to share themselves and nobody able to fix it. Send only the ones " +
      "you are changing: {\"features\": {\"contacts\": true}}. It can only ask for what this " +
      "server already provides — asking for more is refused and says why — and switching " +
      "something off always works. It changes NOTHING else about the journal: not the title, " +
      "and never the owner's email address, which is what decides who can get a token here. " +
      "Owner only. Ask the person before switching anything on.",
    inputSchema: {
      type: "object",
      properties: {
        features: {
          type: "object",
          description:
            "Capability name to true or false. Anything you leave out is left alone.",
          additionalProperties: { type: "boolean" },
        },
      },
      required: ["features"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // It writes one boolean per named capability into the journal's own
      // config and leaves every other key in the file untouched.
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: setJournalFeaturesTool,
  },
  {
    name: "set_journal_profile",
    title: "Change what this journal says about itself",
    description:
      "Change a journal's title, tagline, languages, display currencies or listing — the " +
      "things it says about itself, as opposed to what it can do (that is " +
      "set_journal_features). Until now these were fixed when the journal was created, so a " +
      "title typoed at signup was permanent unless somebody had a shell on the server. Send " +
      "only what you are changing; anything you leave out is left alone. It will NOT change " +
      "the owner's email address, which is what decides who can get a token here, and it will " +
      "not change baseCurrency — a cost written without a currency IS a cost in the base " +
      "currency, so moving it would silently change what every amount already recorded means. " +
      "Owner only, and ask the person before making a private journal public.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the journal is called." },
        tagline: {
          type: "string",
          description: "One line under the title. Send \"\" to remove it.",
        },
        visibility: {
          type: "string",
          enum: ["public", "private"],
          description:
            "Whether this server ADVERTISES the journal — on the landing page, in " +
            "/documentation.txt, in the sitemap. A private journal is unlisted, not locked: " +
            "who may read a journey is still that trip's own visibility. Ask before making " +
            "one public.",
        },
        startLocation: {
          type: "string",
          description: "Where they usually set out from. Send \"\" to remove it.",
        },
        units: { type: "string", enum: ["metric", "imperial"] },
        locales: {
          type: "array",
          items: { type: "string" },
          description:
            "The languages the journal offers, most preferred first: [\"de\", \"en\"]. Codes, " +
            "not names. A language this software ships no menus for still works — its content " +
            "translations render and the menus fall back to English. Must contain " +
            "defaultLocale; send both together when changing that.",
        },
        defaultLocale: {
          type: "string",
          description: "Which of `locales` a reader gets first. Must be one of them.",
        },
        displayCurrencies: {
          type: "array",
          items: { type: "string" },
          description:
            "Which currencies a reader can see the totals in. Must include the journal's base " +
            "currency, which this call cannot change — read it back from " +
            "GET /api/v1/<user>/config.",
        },
        manualRates: {
          type: "object",
          additionalProperties: { type: ["number", "null"] },
          description:
            "Rates for currencies the ECB does not publish, merged into whatever is there: " +
            "{\"VND\": 30500} reads \"1 EUR = 30 500 VND\", so a currency worth less than the " +
            "euro has a LARGE number. That is the OPPOSITE direction from a trip's own " +
            "`rates`, which is base-per-unit. Send null for a code to remove it.",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // It writes the named keys into the journal's own config and leaves
      // every other key in the file untouched.
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: setJournalProfileTool,
  },
  {
    name: "create_trip",
    title: "Create a trip",
    description:
      "Create a trip in this journal, so there is somewhere to write days into. Needs a start " +
      "and an end date — a trip without both is skipped when the site reads it. Created " +
      "PRIVATE unless you are told otherwise: publishing somebody's journey is their decision, " +
      "not a default. Only the journal's owner can call this. This is the only call that " +
      "writes a trip's metadata — `people`, `rates` and `translations` cannot be changed " +
      "afterwards by any call, so ask the person before sending them and leave out what you " +
      "were not told. A cover image cannot be set here at all: there are no photographs in a " +
      "trip that does not exist yet.",
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
        status: { type: "string", enum: ["upcoming", "current", "past"], description: "Usually leave this out. `past` and `upcoming` are derived from `start` every time the site reads the trip, so setting either is a hint that the calendar will overrule. `current` is the one real choice: exactly one trip should have it, and it is the one served at the bare /<user> URL." },
        accent: { type: "string", enum: ["sky", "yellow", "green", "coral", "navy"], description: "Colour. Default sky." },
        visibility: { type: "string", enum: ["private", "public", "guest"], description: "Who is let in. Default private." },
        listed: {
          type: "boolean",
          description:
            "Whether the trip is advertised. It only ever NARROWS: `false` on a public trip " +
            "means anybody with the link can read it but it appears in no sitemap, feed or " +
            "trip switcher — the setting for a journey somebody will mail to their family. " +
            "`true` on a trip no visibility advertises is refused, because nothing would come " +
            "of it. Default true, which changes nothing on a closed trip.",
        },
        costsVisibility: {
          type: "string",
          enum: ["public", "guests"],
          description:
            "Who may see what the trip cost, among the readers already allowed to open it. " +
            "Default public. `guests` narrows the numbers to the people who were on the trip " +
            "and the readers the owner has approved into the journal. This is not visibility: " +
            "it decides nothing about who may open the trip.",
        },
        intro: { type: "string", description: "A paragraph introducing the trip. Only what you were told." },
        test: {
          type: "boolean",
          description:
            "TRUE only if this trip did not happen — a journey nobody took, created to prove " +
            "the software works. Inherited by every day written into it, so set it here rather " +
            "than on each entry. The site says so in a banner and keeps the trip out of the " +
            "feed, the search index and the sitemap.",
        },
        people: {
          type: "array",
          maxItems: MAX_TRIP_PEOPLE,
          description:
            "Who took this trip — at most ten. It is the byline, AND it is write access: " +
            "everyone named may write to the whole trip and may ask for a token scoped to it, " +
            "using the address given here. So name the people who were actually there, from " +
            "what the owner told you, and nobody else. It cannot be changed afterwards by any " +
            "call, so ask rather than guess.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Their name, as the byline should read." },
              email: {
                type: "string",
                description:
                  "Their own address. It is how they get a token for this trip, so a " +
                  "placeholder gives them nothing.",
              },
              nickname: {
                type: "string",
                description:
                  "What to call them in a byline, if it is not their name. Never guessed by " +
                  "splitting the name.",
              },
            },
            required: ["name", "email"],
            additionalProperties: false,
          },
        },
        rates: {
          type: "object",
          description:
            "This trip's frozen exchange rates: how many units of the journal's BASE currency " +
            "one unit of the keyed currency was worth on this trip. {\"THB\": 0.0245} reads " +
            "\"1 THB = 0.0245 CHF\". A currency worth less than the base one therefore has a " +
            "SMALL number — the ECB table points the other way and getting it backwards is " +
            "wrong by orders of magnitude with no error anywhere. Without a rate, costs in " +
            "that currency are shown unconverted, which is a supported state: leave it out " +
            "rather than invent a number. Never today's rate for a trip in the past.",
          additionalProperties: { type: "number" },
        },
        translations: {
          type: "object",
          description:
            "The trip's title and tagline in the journal's other languages, keyed by locale: " +
            "{\"de\": {\"title\": \"Japan\", \"tagline\": \"Sechs Wochen mit dem Zug\"}}. Only " +
            "languages the journal declares are accepted — anything else would be written and " +
            "never rendered.",
          additionalProperties: {
            type: "object",
            properties: { title: { type: "string" }, tagline: { type: "string" } },
            additionalProperties: false,
          },
        },
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
      "Write one day of a trip. It is created as a DRAFT and is not on the site: `publish_day` " +
      "puts it up, and there is no argument here that does it in one motion — the gap is where " +
      "the person reads it back. Write only " +
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
        test: {
          type: "boolean",
          description:
            "TRUE only if this day did not happen — content invented to prove the pipeline " +
            "works. The page then says so in a banner, and the day is kept out of the feed, " +
            "the search index and the sitemap. Writing \"this is a test\" into the prose " +
            "instead is a convention the next reader cannot rely on; this is the guarantee.",
        },
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
    name: "edit_day",
    title: "Edit a day that already exists",
    description:
      "Change one or more fields of a day you already wrote — a coordinate that was " +
      "missing, a misspelled place, a date that was wrong. Send only what changes; " +
      "everything else, formatting included, is left alone. THIS CANNOT PUBLISH OR " +
      "UNPUBLISH A DAY: a draft you edit is still a draft, and a published day you edit " +
      "stays published and visible to whoever already read it. `publish_day` is the only " +
      "call that moves a day between the two — there is no `status` argument here for " +
      "exactly that reason, and sending one is refused. Editing a published day changes " +
      "what its readers see, so treat it the way you would treat writing it in the first " +
      "place.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Trip id, as list_trips reports it." },
        slug: { type: "string", description: "The day's slug, as list_drafts or get_day reports it." },
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD." },
        time: { type: "string", description: "HH:MM." },
        location: { type: "string" },
        country: { type: "string" },
        lat: { type: "number" },
        lng: { type: "number" },
        content: { type: "string", description: "Replaces the entry's whole body." },
        tags: { type: "array", items: { type: "string" } },
        test: {
          type: "boolean",
          description: "Same meaning as on create_day. False removes the flag.",
        },
      },
      required: ["trip", "slug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // Nothing is removed — a field is changed or left alone, and the file
      // itself still exists afterwards either way.
      destructiveHint: false,
      // Sending the same edit twice leaves the day in the same state; unlike
      // create_day there is no duplicate to create.
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: editDay,
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
    name: "create_invite",
    title: "Make a link that lets somebody in",
    description:
      "Make a link the owner can send to a person. TWO KINDS, and they are not " +
      "interchangeable: `guest` leads to reading the journal (every trip marked `guest`, " +
      "never a `private` one) and is safe to forward; `buddy` needs a `trip` and leads to " +
      "WRITE ACCESS to that trip, plus the journal's guest trips — it is for the people who " +
      "were actually on it and is NOT the one for a group chat. Ask which the person means " +
      "rather than guessing. NEITHER LINK GRANTS ANYTHING: whoever opens it proves their " +
      "own address and lands in the owner's queue, and the owner lets each person in by " +
      "hand — so report a link as an invitation to ask, never as \"they now have access\". " +
      "The link is returned once and stored only hashed; a lost one is reissued, not looked " +
      "up. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["guest", "buddy"],
          description: "`buddy` grants write access to one trip once approved.",
        },
        trip: {
          type: "string",
          description:
            "Required for `buddy`, refused for `guest` — a guest is a guest of the journal " +
            "and never of one trip.",
        },
        name: {
          type: "string",
          description: "Whom it is for. Greets them on the landing page; never identity.",
        },
        locale: { type: "string", description: "The language the landing page opens in." },
        days: {
          type: "number",
          description: "How long it stays live. Thirty days if you do not say.",
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // It creates a way of asking, and takes nothing away.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: createInviteTool,
    // Refused by the handler without it, and now absent from the list as
    // well: a tool list is how an agent decides what it can do here, and
    // three tools that cannot work is a list that has to be corrected by
    // trying them. B183.
    requires: "contacts",
  },
  {
    name: "list_invites",
    title: "Every invite link this journal has issued",
    description:
      "What has been handed out, with its kind, what it opens, how often it has been used " +
      "and whether it is still live. Never the links themselves: only their hashes were " +
      "stored. Owner only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: listInvitesTool,
    // Refused by the handler without it, and now absent from the list as
    // well: a tool list is how an agent decides what it can do here, and
    // three tools that cannot work is a list that has to be corrected by
    // trying them. B183.
    requires: "contacts",
  },
  {
    name: "revoke_invite",
    title: "Stop one invite link working",
    description:
      "Kill a link. Everybody already approved STAYS IN — this takes nothing back from " +
      "anybody, which is the whole reason links replaced a shared password that could only " +
      "be changed for everyone at once. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The link's id, as list_invites reports it." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      // It removes a way of asking, not anybody's access.
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: revokeInviteTool,
    // Refused by the handler without it, and now absent from the list as
    // well: a tool list is how an agent decides what it can do here, and
    // three tools that cannot work is a list that has to be corrected by
    // trying them. B183.
    requires: "contacts",
  },
  {
    name: "publish_day",
    title: "Publish a draft",
    description:
      "Put a draft on the site. This is ordinary work and it is yours to do — but ask them " +
      "first, in words, and do not call it because the day looks finished to you. Nothing " +
      "here can check that you asked. Only the journal's owner can publish: a token scoped " +
      "to one trip writes days and cannot put them on the site. Publishing cannot really " +
      "be undone — taking a day down removes it from the journal, not from the people who " +
      "have already read it.",
    inputSchema: {
      type: "object",
      properties: {
        trip: { type: "string", description: "Trip id, as list_trips reports it." },
        slug: { type: "string", description: "The draft's slug, as list_drafts reports it." },
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
 * The tools this session may **call**.
 *
 * A signup token proves an address and nothing else — there is no journal for
 * it to read or write, so it sees one tool and this is what enforces that.
 * Everything else in the registry is callable; whether the capability behind a
 * tool is on is the handler's own question, answered in the handler's own
 * words.
 */
function callableTools(session: Session): readonly ToolEntry[] {
  return session.owner === SIGNUP_OWNER
    ? TOOLS.filter((t) => t.name === "create_journal")
    : TOOLS.filter((t) => t.name !== "create_journal");
}

/**
 * The tools this session is **shown**, which is narrower — B183.
 *
 * A disabled capability is *absent* rather than broken everywhere else in this
 * codebase (AGENTS.md, and B74 for the same shape in the UI), and until B183
 * the three invite tools were advertised to journals with contacts switched
 * off. Nothing broke and nothing leaked; it was a list an agent could only
 * correct by calling things, and the tool list is how an agent decides what it
 * can do here.
 *
 * **Listing and calling are deliberately not the same set.** Filtering the
 * call would turn a clear "contacts are not enabled for this journal" into
 * "unknown tool", which is a worse answer to a client holding a list it
 * fetched before the capability changed — and the handler's check is what
 * actually enforces this in either case. The filter is honesty, not security,
 * so it belongs on the side that is read rather than the side that acts.
 */
export function toolsFor(session: Session): readonly ToolEntry[] {
  return callableTools(session).filter(
    (t) => !t.requires || isEnabled(t.requires, session.owner),
  );
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

/**
 * Make `additionalProperties: false` mean what it says.
 *
 * Every schema in this file declares it, and until B157 nothing enforced it:
 * an unknown argument was dropped in silence and the call went through. That
 * is a bad promise to hand an agent, because the failure it produces is the
 * quiet kind — `create_day` accepted `test: true` for as long as the property
 * was undeclared, ignored it, and answered "created as a draft", so an agent
 * that did exactly what AGENTS.md asks came away believing a day nobody lived
 * was flagged when it was not.
 *
 * Refusing is the whole fix. A mistyped argument an agent can see is a
 * question it asks; one it cannot see is a wrong answer it repeats.
 */
function unknownProperties(tool: ToolDefinition, args: Args): string[] {
  if (tool.inputSchema.additionalProperties !== false) return [];
  const declared = new Set(Object.keys(tool.inputSchema.properties));
  return Object.keys(args).filter((key) => !declared.has(key));
}

export async function callTool(
  name: string,
  session: Session,
  args: Args,
): Promise<ToolOutcome | null> {
  // `callableTools`, not `toolsFor`: a tool whose capability is off is hidden
  // from the list and still answers with its own refusal when called. B183.
  const tool = callableTools(session).find((t) => t.name === name);
  if (!tool) return null;

  const unknown = unknownProperties(tool, args);
  if (unknown.length > 0) {
    const declared = Object.keys(tool.inputSchema.properties).join(", ");
    return {
      ok: false,
      error:
        `${name} does not take ${unknown.map((k) => JSON.stringify(k)).join(", ")}, and nothing ` +
        `was written. This tool's schema says additionalProperties: false, so an argument it ` +
        `does not know is refused rather than dropped — if you meant one of these, send that ` +
        `instead: ${declared}.`,
    };
  }

  return tool.handler(session, args);
}
