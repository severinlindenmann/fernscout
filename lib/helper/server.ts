import "server-only";
import fs from "node:fs";
import { COSTS_IMPORTERS } from "@/importers/costs";
import { GPS_IMPORTERS } from "@/importers/gps";
import { resolveAccess } from "../auth/handshake";
import { costForDay, costLocalForDay } from "../costs";
import { AS_AUTHOR, getAllEntries, getAllMedia, getDays, getEntryBySlug } from "../entries";
import { getTrips, tripRef } from "../trips";
import type { Day, DaySummary } from "../types";
import { findInboxFile, listInbox, type InboxEntry, type InboxKind } from "../inbox";
import { resolveCookieCaller, trustedCaller } from "./caller";
import { isWritten, type WizardDraft } from "./draft";

/**
 * The helper's own door guard — B682.
 *
 * **Cookie only, and bearer refused by construction.** `isOwner` in
 * `lib/contacts/session.ts` answers the same question for either credential,
 * and it is right to: the surfaces it guards are things an owner does from a
 * page *or* from a script. The wizard is not one of those. It is a browser
 * flow, everything it can do an agent can already do through `/api/v1/…` with
 * its own token, and a second bearer-accepting write surface outside the
 * documented contract is exactly what `/openapi.json` would then be lying
 * about. So this asks `resolveAccess` — which reads the two cookies and
 * nothing else — and never looks at an `Authorization` header.
 *
 * The address is re-checked against `owner.email` on every call, so a
 * year-old identity cookie opens what its holder is entitled to today (B410).
 *
 * Since B1055 this is `./caller.ts`'s cookie proof, asked as a yes/no
 * question — the resolver is what a WhatsApp caller goes through instead,
 * and this route family keeps asking for a cookie exactly as before.
 *
 * **One exception, added by B1230 and never reachable over the network.**
 * `./caller.ts`'s `trustedCaller()` answers first, and only a same-process
 * call wrapped in `runAsCaller()` ever has one set — a WhatsApp accept tap
 * executing the very route a browser's own button would post to, for a
 * caller `lib/whatsapp/dispatch.ts` has already matched by phone number. No
 * request arriving over HTTP can ever populate it, so an ordinary browser or
 * bearer caller reaches exactly the cookie check below, unchanged.
 */
export async function isHelperOwner(username: string): Promise<boolean> {
  const trusted = trustedCaller();
  if (trusted) return trusted.username === username;
  return (await resolveCookieCaller(username)) !== null;
}

/**
 * The helper family's one refusal — B779, and B807.
 *
 * The status stays 404 and stays the same for a journal that is not yours as
 * for one that does not exist: a wizard URL must not confirm whose journal it
 * is, and every route here answers alike for that reason.
 *
 * What was wrong was the word. A caller holding a **valid** agent token for
 * the journal it named was told `not_your_journal` — that they do not own a
 * journal they demonstrably do own — when the actual cause is that this
 * family never reads `Authorization` at all (`isHelperOwner` above). So when
 * a bearer token is present, the body says so and names the door that does
 * take it. It confirms nothing: the caller has already proved who they are,
 * and the sentence is the same one for a token belonging to somebody else.
 *
 * ## The third answer, and why it is safe — B807
 *
 * A person mid-task on the live site had his session stop being recognised and
 * got `not_your_journal` with nothing on the screen. He read that as the
 * software being broken and closed the tab, which is the correct reading of
 * it: he had not stopped owning his journal, he had stopped being signed in,
 * and the two are not the same sentence.
 *
 * So a request carrying **no address at all** is told its session has lapsed,
 * and `components/HelperAsk.tsx` puts the way back in on the screen. This
 * leaks nothing, and the reason is worth stating: with nobody signed in, every
 * username on this instance answers this identically — the answer is about the
 * *request*, not about the journal. The moment an address is present the 404
 * comes back, unexplained, because at that point the answer would be about
 * whose journal this is.
 *
 * `resolveAccess` is `cache()`d per request, so asking it a second time here
 * after `isHelperOwner` costs nothing.
 */
export async function notYourJournal(request: Request, username: string): Promise<Response> {
  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_your_journal",
        message:
          "This is the helper — a browser flow — and it reads a signed-in session " +
          "cookie only. It never looks at an Authorization header, so a valid token " +
          "gets this same answer, and this is not a statement about who owns the " +
          "journal. Everything here an agent does through /api/v1/<user>/… with that " +
          "token: see /documentation.txt and /openapi.json.",
      },
      { status: 404 },
    );
  }

  const { email } = await resolveAccess(username);
  if (!email) {
    return Response.json({ error: "session_lapsed" }, { status: 401 });
  }

  return Response.json({ error: "not_your_journal" }, { status: 404 });
}

/** One trip, as the wizard's first step needs it. */
export type WizardTrip = {
  id: string;
  title: string;
  start: string;
  end: string;
};

export function tripsForWizard(username: string): WizardTrip[] {
  return getTrips(username)
    .map((trip) => ({ id: trip.id, title: trip.title, start: trip.start, end: trip.end }))
    .sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * Every unfinished day in this journal, newest first.
 *
 * This is the resume card's whole source, and the reason there is no session
 * table: the drafts on disk already say what is unfinished and how far it got.
 * `getAllEntries` with `AS_AUTHOR` is the same read `GET /api/v1/<user>/drafts`
 * makes.
 */
export function draftsForWizard(username: string): WizardDraft[] {
  const out: WizardDraft[] = [];
  for (const trip of getTrips(username)) {
    for (const entry of getAllEntries(trip.ref, AS_AUTHOR)) {
      if (!entry.draft) continue;
      out.push({
        trip: trip.id,
        slug: entry.slug,
        date: entry.date,
        title: entry.title,
        photos: entry.gallery.length,
        written: isWritten(entry.content),
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * One day the wizard is holding — draft **or published** (B816).
 *
 * `draftsForWizard` above is the resume list and stays drafts-only; this is
 * the read behind `GET /api/helper/<user>/day`, and a published day has to
 * come back through it or the browser is read-only the moment a day goes up.
 * `published` is what the screen turns into a different sentence and a
 * different button — never into a different write.
 */
export function dayForWizard(
  username: string,
  tripId: string,
  slug: string,
): WizardDraft | null {
  const entry = getEntryBySlug(tripRef(username, tripId), slug, AS_AUTHOR);
  if (!entry) return null;
  return {
    trip: tripId,
    slug: entry.slug,
    date: entry.date,
    title: entry.title,
    photos: entry.gallery.length,
    written: isWritten(entry.content),
    ...(entry.draft ? {} : { published: true as const }),
    ...(entry.lat !== undefined && entry.lng !== undefined
      ? { hasCoordinates: true as const }
      : {}),
  };
}

/**
 * The days of a finished trip that nobody ever started — B819.
 *
 * The journal already knows both halves: the trip's own dates, and which
 * dates carry an entry. Nothing showed the difference, so a person returning
 * to a half-written trip had to remember which days were missing and type
 * them in.
 *
 * **One trip, and only one that has ended.** A trip still running has days
 * that are missing because they have not happened yet, and a trip nobody has
 * written a word of is not a gap — it is a trip somebody has not started. What
 * comes back is the most recently finished trip that has at least one day
 * written and at least one day missing, or nothing at all: the ticket's own
 * warning is that a trip where somebody deliberately wrote three days of
 * fourteen is not a to-do list with eleven failures on it.
 */
export type TripGap = {
  trip: string;
  title: string;
  /** How many days the trip ran. */
  total: number;
  /** The dates with no entry of any kind, oldest first. */
  missing: string[];
};

export function gapsForWizard(username: string, today: string): TripGap | null {
  for (const trip of getTrips(username).sort((a, b) => b.end.localeCompare(a.end))) {
    if (trip.end >= today) continue;
    const written = new Set(getAllEntries(trip.ref, AS_AUTHOR).map((entry) => entry.date));
    if (written.size === 0) continue;
    const missing: string[] = [];
    let total = 0;
    for (let at = new Date(`${trip.start}T00:00:00Z`); ; at.setUTCDate(at.getUTCDate() + 1)) {
      const date = at.toISOString().slice(0, 10);
      if (date > trip.end) break;
      total += 1;
      // A trip whose dates are the wrong way round, or one that ran a year:
      // stop rather than walk forever.
      if (total > 400) break;
      if (!written.has(date)) missing.push(date);
    }
    if (missing.length === 0) continue;
    return { trip: trip.id, title: trip.title, total, missing };
  }
  return null;
}

/**
 * The day exactly as a reader's own page would build it, so the preview
 * cannot flatter it.
 *
 * Every other update written on the same date comes along, because that is
 * what the story page draws: a second update the person forgot about is part
 * of how the day will read, and a preview showing only the new one would be a
 * quietly optimistic lie.
 */
export function previewOf(
  username: string,
  tripId: string,
  slug: string,
): { day: Day; summary: DaySummary; dayIndex: number } | null {
  const ref = tripRef(username, tripId);
  const days = getDays(ref, AS_AUTHOR);
  // The day's place in the trip, because the card prints "Day 4" in its corner
  // and a preview that always said "Day 1" would be wrong about the one thing
  // a reader uses to orient themselves.
  const dayIndex = days.findIndex((d) => d.entries.some((e) => e.slug === slug));
  if (dayIndex < 0) return null;
  const day = days[dayIndex];
  const lead = day.lead;
  return {
    dayIndex,
    day,
    summary: {
      date: day.date,
      slug: lead.slug,
      location: lead.location,
      country: lead.country,
      countryCode: lead.countryCode,
      lat: lead.lat,
      lng: lead.lng,
      transport: lead.transport,
      travelScene: lead.travelScene,
      updates: day.entries.length,
      cost: costForDay(ref, day.entries),
      costLocal: costLocalForDay(ref, day.entries),
    },
  };
}

/* -------------------------------------------------------------------------
 * What is sitting in the inbox, and what each file could become — B689.
 *
 * `lib/inbox.ts` has held files that belong to no day since B663, and since
 * B683 the helper's own upload step parks anything that is not a photograph
 * there rather than refusing it. Nothing read them. This is the screen that
 * does, and the *guess* below is the whole of it — deterministic, from the
 * file's own first bytes, through the importers that already exist. No model
 * is asked what a file is; a model only ever reads a header row, and only for
 * a statement nothing here recognises.
 * ---------------------------------------------------------------------- */

/** What the inbox screen can offer to do with one file. */
type InboxOffer =
  /** A location history one of `importers/gps/` recognises. Read by code. */
  | { kind: "gps"; format: string; label: string }
  /** A bank statement one of `importers/costs/` recognises. Also code. */
  | { kind: "statement"; format: string; label: string }
  /** A CSV nothing recognises: the one case that asks a model for a mapping. */
  | { kind: "statement" }
  /** Something nothing here reads. Offered nothing, and kept anyway. */
  | { kind: "unknown" };

export type InboxItem = { entry: InboxEntry; offer: InboxOffer };

/** The same 64 kB every importer's `detect` is promised. */
const HEAD_BYTES = 64 * 1024;

function headOf(file: string): string {
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(handle, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Everything in `inbox/files/`, newest first, each with what it could become.
 *
 * Photographs are not here: they already have a door (the wizard's own upload
 * step), and listing two hundred of them would bury the one statement.
 */
export function inboxForWizard(username: string): InboxItem[] {
  return listInbox(username).files.map((entry) => {
    const found = findInboxFile(username, entry.id);
    let head = "";
    try {
      if (found) head = headOf(found.file);
    } catch {
      // Unreadable is offered nothing rather than crashing the screen.
    }
    return { entry, offer: offerFor(head, entry.filename) };
  });
}

function offerFor(head: string, filename: string): InboxOffer {
  const gps = GPS_IMPORTERS.find((importer) => importer.detect(head, filename));
  if (gps) return { kind: "gps", format: gps.id, label: gps.label };
  const costs = COSTS_IMPORTERS.find((importer) => importer.detect(head, filename));
  if (costs) return { kind: "statement", format: costs.id, label: costs.label };
  if (/\.csv$/i.test(filename)) return { kind: "statement" };
  return { kind: "unknown" };
}

/* -------------------------------------------------------------------------
 * The files pane, and what a selection in it means — B902.
 *
 * Round 6 of `docs/plans/2026-09-08-the-chat-is-the-product.md`: the inbox and
 * this trip's photographs, side by side, so that "put these on yesterday" has
 * something to mean. Two folders that had no picker between them — the inbox
 * screen (B689) reads statements and location exports and nothing offered a
 * photograph at all — and one sentence that could not refer to either.
 *
 * **The pane is drawn from disk on the server and the browser is never
 * believed about it.** `describeSelection` below re-resolves every id the
 * browser sends against what is actually there, and silently drops the rest:
 * an id is a reference, not a fact, and a sentence sent to a model must never
 * carry a filename this journal does not have.
 * ---------------------------------------------------------------------- */

/** One tile in the files pane. `src` only where something can be drawn — the
 *  inbox is reachable by no URL, by construction (`lib/inbox.ts`), so an
 *  inbox tile is its name and its kind and no picture. */
export type RoomFile = {
  /** `inbox:<id>` or `photo:<slug>:<src>` — the whole of what a selection is. */
  id: string;
  name: string;
  /**
   * A thumbnail. For a photograph on a day this is its own media URL; for a
   * staged photograph it is `/api/helper/<user>/inbox/<id>/thumbnail`, which
   * is owner-only and serves a resized copy — B1123.
   *
   * Absent for a document. A csv has no picture, and the pane draws its
   * extension instead of an empty frame.
   */
  src?: string;
  /** What a person is looking at, so the tile can say so without a lookup. */
  detail?: string;
  /**
   * The three facts the pane sorts and groups by, and the reason B1123 exists:
   * the pane used to show what had been *chosen*, which a person already
   * knows, and hide what is *waiting*, which they do not.
   */
  kind?: InboxKind;
  bytes?: number;
  uploadedAt?: string;
};

/** One trip the pane can offer photographs from — cheap to list (`getTrips`
 *  already holds this), unlike loading any of its media. */
type RoomTrip = { id: string; title: string };

/** What the left-hand pane holds up front: what is waiting, and every trip a
 *  person could ask to see the photographs of. Loading one trip's actual
 *  photographs is a separate, on-demand read — `tripFilesForRoom` below —
 *  because there is no telling in advance which trip, if any, this visit is
 *  about, and every trip's media is not a "load once and forget" cost the
 *  way this list is. B1573. */
export type RoomFiles = {
  inbox: RoomFile[];
  trips: RoomTrip[];
};

/** How many of a trip's photographs the pane offers. A trip of two thousand
 *  is not a picker; the newest are the ones a day being written needs. */
const TRIP_TILES = 60;

/** Newest first, by start date — the order a trip picker lists in, and the
 *  same order `filesForRoom` used to pick a single "the" trip from. */
function tripsNewestFirst(username: string) {
  return [...getTrips(username)].sort((a, b) => b.start.localeCompare(a.start));
}

export function filesForRoom(username: string): RoomFiles {
  const staged = listInbox(username);
  const inbox: RoomFile[] = [...staged.media, ...staged.files]
    // Newest first — what somebody just put there is what they mean.
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .map((entry) => ({
      id: `inbox:${entry.id}`,
      name: entry.filename,
      // Only a photograph has one. The route refuses anything else, so
      // pointing a document at it would draw a broken frame.
      src:
        entry.kind === "media"
          ? `/api/helper/${encodeURIComponent(username)}/inbox/${encodeURIComponent(entry.id)}/thumbnail`
          : undefined,
      detail: entry.description || entry.caption || undefined,
      kind: entry.kind,
      bytes: entry.bytes,
      uploadedAt: entry.uploadedAt,
    }));

  const trips: RoomTrip[] = tripsNewestFirst(username).map((trip) => ({
    id: trip.id,
    title: trip.title,
  }));

  return { inbox, trips };
}

/** One named trip's own photographs, on demand — `GET
 *  /api/helper/<user>/trip-files?trip=<id>` is the only caller. `null` for a
 *  trip id that does not resolve, which the route reads as "not found"
 *  rather than "empty" — the two must not look the same to a caller. */
export function tripFilesForRoom(
  username: string,
  tripId: string,
): { title: string; files: RoomFile[] } | null {
  const trip = tripsNewestFirst(username).find((one) => one.id === tripId);
  if (!trip) return null;
  const files: RoomFile[] = getAllMedia(trip.ref, AS_AUTHOR)
    .slice(0, TRIP_TILES)
    .map((tile) => ({
      id: `photo:${tile.slug}:${tile.src}`,
      name: tile.caption ?? tile.location ?? tile.date,
      src: tile.src,
      detail: tile.date,
    }));
  return { title: trip.title, files };
}

/** A filename is somebody's own and may say anything at all. It is going into
 *  one bracketed line of a model's context, so it loses the two characters
 *  that would let it look like more than one. */
function flat(text: string): string {
  return text.replace(/[\r\n[\]]+/g, " ").trim().slice(0, 80);
}

/**
 * What the person has selected, as one line the model reads — B902.
 *
 * The same shape B900 uses to remember a proposal: a bracketed line the model
 * treats as context rather than as something said. It is **built here, from
 * disk**, so an id nothing answers to contributes nothing — the browser can
 * ask about a file it can see and about nothing else.
 *
 * Empty when nothing resolves, which is what makes the pane an addition: the
 * conversation with nothing selected is exactly the conversation B899 built.
 */
export function describeSelection(username: string, ids: string[]): string {
  const named: string[] = [];
  const photos: string[] = [];
  for (const id of ids.slice(0, 100)) {
    if (id.startsWith("inbox:")) {
      const found = findInboxFile(username, id.slice("inbox:".length));
      // The id, spelled out, and only for a photograph — B915. It is what
      // `attach_files` takes, and it is safe to say because it is a hash of
      // the file's own bytes rather than anything about the person: an id the
      // model invents resolves to nothing, here and again in the route.
      if (found)
        named.push(
          found.entry.kind === "media"
            ? `"${flat(found.entry.filename)}" (a photograph waiting in the inbox, id ${flat(found.entry.id)})`
            : `"${flat(found.entry.filename)}" (waiting in the inbox)`,
        );
      continue;
    }
    if (!id.startsWith("photo:")) continue;
    const rest = id.slice("photo:".length);
    const at = rest.indexOf(":");
    if (at < 0) continue;
    const slug = rest.slice(0, at);
    const src = rest.slice(at + 1);
    for (const trip of getTrips(username)) {
      const entry = getEntryBySlug(trip.ref, slug, AS_AUTHOR);
      if (entry?.gallery.some((item) => item.src === src)) {
        photos.push(`${flat(entry.date)} (${flat(entry.title)})`);
        break;
      }
    }
  }
  if (named.length === 0 && photos.length === 0) return "";
  const parts = [
    named.length > 0 ? `${named.length} file(s) waiting in the inbox: ${named.join(", ")}` : "",
    photos.length > 0
      ? `${photos.length} photograph(s) already on days: ${[...new Set(photos)].join(", ")}`
      : "",
  ].filter((part) => part !== "");
  return `[they have selected, in the files pane beside this conversation: ${parts.join("; ")}. "these", "those" and "the selected ones" mean exactly this and nothing else. To put the waiting photographs on a day, call attach_files with those ids, comma-separated, exactly as spelled here. You cannot receive a file yourself: add_photos hands them the day's own page, which has the picker.]`;
}
