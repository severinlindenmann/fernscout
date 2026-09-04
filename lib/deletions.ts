import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashSecret } from "./auth";
import { isEnabled } from "./capabilities";
import { clearConfigCache } from "./config";
import { balanceOf } from "./credits";
import { contentRoot } from "./contentRoot";
import { getDatabase, TABLE_NAMES } from "./db";
import type { TranslationKey } from "./i18n";
import { translateIn } from "./locales";
import { sendTransactional } from "./mail";
import { renderMail, type MailBlock } from "./mail/template";
import { serverSite } from "./site";
import { writeTombstone } from "./tombstones";
import { forgetEntries, getAllEntries } from "./entries";
import { getTrip, getTrips, parseTripRef, tripDir, tripRef } from "./trips";
import { clearUserCache, getUser, userDir } from "./users";
import { sql } from "kysely";

/**
 * Deleting a journal, or one trip out of it.
 *
 * Everything a person owns can be created through the API and, until now,
 * nothing could be removed through it: the only way back from a journal
 * created by mistake was a shell on the server. That undercuts the export —
 * "the anti-lock-in pitch, made concrete" — because taking your data out is
 * only half of leaving.
 *
 * **The mail is the gate, and it is the whole design.** `lib/agentConfirm.ts`
 * already refuses a destructive call once and hands back a code; it is well
 * built and it is not enough here, because it is deliberately not single-use
 * and the code goes *to the agent*. An agent asked to write up a day can
 * therefore satisfy its own confirmation. For a draft day that is the right
 * trade. For somebody's photographs and every word they wrote it is not, and
 * the failure mode is an agent that reads "get rid of that test entry" as "get
 * rid of that journal".
 *
 * So calling `DELETE` deletes nothing. It answers `202`, and mails the address
 * in the journal's own `config.json` a link only a person can follow. That
 * also re-proves the address still belongs to them, which nothing else in this
 * path would.
 *
 * The link does not delete on GET either — see `app/[user]/delete/[token]`.
 */

/** An hour. Long enough to read the mail after dinner, short enough that a
 * link sitting in an archived mailbox is not a live weapon. */
export const DELETION_TTL_MS = 60 * 60 * 1000;
export const DELETION_TTL_MINUTES = String(DELETION_TTL_MS / 60_000);

export type DeletionTarget =
  | { kind: "journal"; username: string }
  | { kind: "trip"; username: string; tripId: string };

/** What would go, in the numbers a person needs to recognise it. */
export type DeletionSummary = {
  kind: "journal" | "trip";
  username: string;
  tripId?: string;
  /** The journal's title, or the trip's. */
  title: string;
  /** The journal's title, always — a trip's mail needs to name its journal. */
  journalTitle: string;
  /** Only meaningful for a journal. */
  trips: number;
  days: number;
  files: number;
  bytes: number;
  /**
   * The journal's own credit balance (B366), at the moment of asking.
   * `null` means credits are switched off on this server — a different fact
   * from a balance of zero, and the two must not be rendered the same way
   * (B374). Only ever set for `kind: "journal"`: deleting a trip destroys no
   * credits (`credits` and `credit_ledger` carry no `trip_id`, so the per-table
   * sweep in `deleteTrip` below never reaches them), so nothing here
   * computes it for that case.
   */
  credits?: number | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Bytes and file count under a directory, following nothing. */
function measure(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = measure(full);
      files += inner.files;
      bytes += inner.bytes;
    } else if (entry.isFile()) {
      files += 1;
      try {
        bytes += fs.statSync(full).size;
      } catch {
        // Vanished between the readdir and the stat. Not worth failing over.
      }
    }
  }
  return { files, bytes };
}

/** `1.4 GB`. Written for the sentence "you are about to delete …", so it is
 * decimal units — what a person's file manager shows them. */
export function humanBytes(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * What is about to be deleted, counted off disk.
 *
 * Drafts are counted with everything else. They are the part somebody is most
 * likely to have forgotten exists, and the whole purpose of this number is to
 * be recognised — "three journeys, ninety-one days" — before the button.
 */
export function summarise(target: DeletionTarget): DeletionSummary | null {
  const user = getUser(target.username);
  if (!user) return null;

  if (target.kind === "journal") {
    const trips = getTrips(target.username);
    const days = trips.reduce(
      (n, trip) => n + getAllEntries(tripRef(target.username, trip.id), { includeDrafts: true }).length,
      0,
    );
    const { files, bytes } = measure(userDir(target.username));
    return {
      kind: "journal",
      username: target.username,
      title: user.title,
      journalTitle: user.title,
      trips: trips.length,
      days,
      files,
      bytes,
    };
  }

  const ref = tripRef(target.username, target.tripId);
  const trip = getTrip(ref);
  if (!trip) return null;
  const { files, bytes } = measure(tripDir(ref));
  return {
    kind: "trip",
    username: target.username,
    tripId: target.tripId,
    title: trip.title,
    journalTitle: user.title,
    trips: 1,
    days: getAllEntries(ref, { includeDrafts: true }).length,
    files,
    bytes,
  };
}

/**
 * `summarise`, plus the one fact it cannot carry because it is a database
 * read and `summarise` is a synchronous walk of the disk.
 *
 * Kept separate rather than folded into `summarise` itself: the tombstone
 * notice and the per-table sweep both call `summarise` for a title alone,
 * long after there is a journal left to hold a balance, and making every one
 * of those callers `await` a query they never look at would be a cost paid
 * everywhere for a fact needed in exactly two places — the mail and the page.
 */
async function summariseWithCredits(target: DeletionTarget): Promise<DeletionSummary | null> {
  const summary = summarise(target);
  if (!summary || summary.kind !== "journal") return summary;
  return { ...summary, credits: await balanceOf(summary.username) };
}

export type DeletionRequested = {
  ok: true;
  /** Where the mail went, as the owner would recognise it. */
  email: string;
  expiresAt: string;
  summary: DeletionSummary;
};

export type DeletionRefused = { ok: false; error: string; message: string; status: number };

/**
 * Ask for a deletion: writes a request, mails the owner a link, deletes
 * nothing.
 *
 * The address comes from `content/<user>/config.json`, never from the session
 * that asked. They are the same address today — only the owner's token gets
 * this far — but reading it from the config means a credential can never
 * route its own confirmation somewhere else.
 */
export async function requestDeletion(
  target: DeletionTarget,
  options: { sessionId?: string } = {},
): Promise<DeletionRequested | DeletionRefused> {
  const user = getUser(target.username);
  if (!user) {
    return {
      ok: false,
      status: 404,
      error: "no_such_journal",
      message: `No journal called "${target.username}".`,
    };
  }

  const summary = await summariseWithCredits(target);
  if (!summary) {
    return {
      ok: false,
      status: 404,
      error: "unknown_trip",
      message: `"${target.username}" has no trip called "${target.kind === "trip" ? target.tripId : ""}".`,
    };
  }

  const email = user.owner.email?.trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      status: 409,
      error: "no_owner_address",
      message:
        `"${target.username}" has no owner.email in its config.json, so there is nobody to ` +
        `send the confirmation to — and this server will not delete a journal on a token's ` +
        `say-so alone. A person has to add the address to the file first.`,
    };
  }

  // Mail is the gate. Without it there is no second step, and a deletion that
  // quietly fell back to the agent's own word would be the exact thing this
  // exists to prevent. Absent rather than broken — see AGENTS.md.
  if (!isEnabled("mail")) {
    return {
      ok: false,
      status: 404,
      error: "deletion_unavailable",
      message:
        "This server cannot send mail, and the confirmation for a deletion is a mail to the " +
        "owner. There is no way to delete over the API here. /api/health says why mail is off.",
    };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DELETION_TTL_MS).toISOString();
  const { db } = await getDatabase();

  // Any earlier live request for the same target is retired first. Two valid
  // links for one journal in one inbox is a way to press the wrong one.
  const supersede = db
    .updateTable("deletion_requests")
    .set({ consumed_at: nowIso() })
    .where("owner_id", "=", target.username)
    .where("kind", "=", target.kind)
    .where("consumed_at", "is", null);
  await (target.kind === "trip"
    ? supersede.where("trip_id", "=", target.tripId)
    : supersede.where("trip_id", "is", null)
  ).execute();

  await db
    .insertInto("deletion_requests")
    .values({
      id: crypto.randomUUID(),
      owner_id: target.username,
      kind: target.kind,
      trip_id: target.kind === "trip" ? target.tripId : null,
      email,
      token_hash: hashSecret(token),
      created_at: nowIso(),
      expires_at: expiresAt,
      consumed_at: null,
      requested_by: options.sessionId ?? null,
    })
    .execute();

  try {
    await sendDeletionMail({ summary, email, nickname: user.owner.nickname, token, locale: user.defaultLocale });
  } catch (err) {
    // The request is retired with the mail, so a failed send does not leave a
    // live token nobody was told about. The same shape as the auth route,
    // which learned this the hard way.
    console.error(`[deletions] confirmation mail for ${target.username} failed:`, err);
    await db
      .updateTable("deletion_requests")
      .set({ consumed_at: nowIso() })
      .where("token_hash", "=", hashSecret(token))
      .execute();
    return {
      ok: false,
      status: 503,
      error: "mail_failed",
      message:
        "The confirmation could not be sent, so nothing is pending and nothing has been " +
        "deleted. Try again in a minute.",
    };
  }

  return { ok: true, email, expiresAt, summary };
}

/** Where the confirmation page lives. One place, so the mail and the route
 * cannot disagree about the shape of it. */
export function deletionUrl(base: string, username: string, token: string): string {
  return `${base.replace(/\/$/, "")}/${username}/delete/${token}`;
}

/** The full archive, authorised by the same token. See the page for why. */
export function deletionExportUrl(base: string, username: string, token: string): string {
  return `${deletionUrl(base, username, token)}/export.zip`;
}

async function sendDeletionMail(input: {
  summary: DeletionSummary;
  email: string;
  nickname: string;
  token: string;
  locale?: string;
}): Promise<void> {
  const site = serverSite();
  const { summary } = input;
  const locale = input.locale ?? "en";
  const t = (key: TranslationKey, vars?: Record<string, string>) => translateIn(locale, key, vars);
  const isJournal = summary.kind === "journal";

  const counts = {
    trips: String(summary.trips),
    days: String(summary.days),
    files: String(summary.files),
    size: humanBytes(summary.bytes),
    url: `${site.url}/${summary.username}`,
    title: summary.title,
    journal: summary.journalTitle,
    nickname: input.nickname,
    site: site.name,
    minutes: DELETION_TTL_MINUTES,
  };

  // Absent rather than a "0 credits" line, on a server with credits switched
  // off or a journal that never held any — B74's rule, restated for money
  // instead of a currency total. See the type's doc comment on why this is
  // only ever set for a journal.
  const creditsLine: MailBlock[] =
    typeof summary.credits === "number" && summary.credits > 0
      ? [{ kind: "paragraph", text: t("del.credits", { ...counts, credits: String(summary.credits) }) }]
      : [];

  const blocks: MailBlock[] = [
    { kind: "paragraph", text: t(isJournal ? "del.journalIntro" : "del.tripIntro", counts) },
    { kind: "heading", text: t("del.whatGoesHeading") },
    { kind: "paragraph", text: t(isJournal ? "del.journalWhatGoes" : "del.tripWhatGoes", counts) },
    ...creditsLine,
    // Above the delete button, on purpose. Somebody about to remove five years
    // of writing should be handed a copy without having to think of it.
    { kind: "heading", text: t("del.exportHeading") },
    { kind: "paragraph", text: t("del.export", counts) },
    {
      kind: "button",
      text: t("del.exportButton"),
      href: deletionExportUrl(site.url, summary.username, input.token),
    },
    { kind: "paragraph", text: t("del.linkNote") },
    {
      kind: "button",
      text: t("del.confirmButton"),
      href: deletionUrl(site.url, summary.username, input.token),
    },
    { kind: "paragraph", text: t("del.expiry", counts) },
    { kind: "paragraph", text: t("del.backups") },
    { kind: "paragraph", text: t("del.notYou") },
  ];

  /**
   * Sent whatever the journal's own `features.mail.enabled` says.
   *
   * This letter *is* the safety mechanism (B38): `DELETE` removes nothing and
   * answers 202, and the button in this mail is the only thing that deletes.
   * Letting a per-journal mail preference swallow it would leave the API
   * accepting deletions that can never happen, which is worse than refusing
   * them — and the address it goes to is the owner's own, out of
   * `config.json`, never a reader's. The server-wide check above is the one
   * that can stop this flow, and it stops it up front with a 404 rather than
   * silently. See `sendTransactional` in ./mail, and B60.
   */
  await sendTransactional(
    renderMail(
      input.email,
      t(isJournal ? "del.journalSubject" : "del.tripSubject", counts),
      {
        preheader: t(isJournal ? "del.journalIntro" : "del.tripIntro", counts),
        title: t(isJournal ? "del.journalTitle" : "del.tripTitle"),
        blocks,
        footer: t("del.footer", counts),
      },
      summary.username,
    ),
    "the confirmation link for a deletion the owner has already asked for",
  );
}

export type PendingDeletion = {
  id: string;
  kind: "journal" | "trip";
  username: string;
  tripId?: string;
  email: string;
  expiresAt: string;
  summary: DeletionSummary | null;
};

export type TokenRefusal = { ok: false; reason: "unknown" | "expired" | "used" | "gone" };

/**
 * Resolve a link's token, without spending it.
 *
 * Every refusal is separated rather than collapsed into "no". The page has to
 * say which it was: "you have already deleted this" and "this link expired"
 * send a person to two different next steps, and answering both with a 404
 * leaves them believing they broke something.
 *
 * The username in the URL has to match the row. It is not the credential —
 * the token is — but a link that resolved regardless of the journal it was
 * pasted under would make the address in the URL a lie.
 */
export async function resolveDeletionToken(
  username: string,
  token: string,
): Promise<{ ok: true; pending: PendingDeletion } | TokenRefusal> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("deletion_requests")
    .selectAll()
    .where("token_hash", "=", hashSecret(token.trim()))
    .executeTakeFirst();

  if (!row || row.owner_id !== username) return { ok: false, reason: "unknown" };
  if (row.consumed_at) return { ok: false, reason: "used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };

  const kind = row.kind === "trip" ? ("trip" as const) : ("journal" as const);
  const target: DeletionTarget =
    kind === "trip"
      ? { kind, username: row.owner_id, tripId: row.trip_id ?? "" }
      : { kind, username: row.owner_id };
  const summary = await summariseWithCredits(target);
  // The target went away between the mail and the click — deleted by hand, or
  // by a second link. There is nothing left to confirm.
  if (!summary) return { ok: false, reason: "gone" };

  return {
    ok: true,
    pending: {
      id: row.id,
      kind,
      username: row.owner_id,
      tripId: row.trip_id ?? undefined,
      email: row.email,
      expiresAt: row.expires_at,
      summary,
    },
  };
}

export type DeletionDone = {
  ok: true;
  kind: "journal" | "trip";
  username: string;
  tripId?: string;
  title: string;
};

/**
 * Spend the link and do it.
 *
 * The row is marked consumed **before** anything is removed, so the link is
 * single-use even if the removal then fails half way — a second press must
 * never start a second sweep over a half-deleted journal.
 */
export async function confirmDeletion(
  username: string,
  token: string,
): Promise<DeletionDone | TokenRefusal> {
  const resolved = await resolveDeletionToken(username, token);
  if (!resolved.ok) return resolved;

  const { pending } = resolved;
  const { db } = await getDatabase();
  const spent = await db
    .updateTable("deletion_requests")
    .set({ consumed_at: nowIso() })
    .where("id", "=", pending.id)
    .where("consumed_at", "is", null)
    .executeTakeFirst();

  // Two presses at once: whichever update matched no rows lost, and must not
  // go on to delete anything.
  if (Number(spent.numUpdatedRows ?? 0) === 0) return { ok: false, reason: "used" };

  if (pending.kind === "journal") {
    await deleteJournal(username, pending.email);
    return { ok: true, kind: "journal", username, title: pending.summary?.title ?? username };
  }

  const tripId = pending.tripId ?? "";
  await deleteTrip(username, tripId, pending.email);
  return { ok: true, kind: "trip", username, tripId, title: pending.summary?.title ?? tripId };
}

/**
 * The two sentences an old link answers with, in the journal's own language.
 *
 * Built here, while the journal's config is still readable, and stored on the
 * tombstone. `proxy.ts` serves them verbatim: it is the only place in Next
 * that can put a status code on a response before a page renders, and it
 * cannot load a dictionary.
 */
function goneNotice(input: {
  kind: "journal" | "trip";
  username: string;
  title: string;
  journalTitle?: string;
}): { lang: string; title: string; body: string; homeLabel: string; homeHref: string } {
  const locale = getUser(input.username)?.defaultLocale ?? "en";
  const t = (key: TranslationKey, vars?: Record<string, string>) => translateIn(locale, key, vars);
  const vars = { title: input.title, journal: input.journalTitle ?? input.title };
  const journal = input.kind === "journal";
  return {
    lang: locale,
    title: t(journal ? "del.goneTitle" : "del.goneTripTitle"),
    body: t(journal ? "del.goneBody" : "del.goneTripBody", vars),
    // A dead end is the one thing a page like this must not be. A deleted
    // journal sends you to the instance; a deleted trip back to the journal it
    // was in, which is still there.
    homeLabel: journal
      ? t("del.goneHome", { site: serverSite().name })
      : t("err.goToJournal", { title: vars.journal }),
    homeHref: journal ? "/" : `/${input.username}`,
  };
}

/**
 * Resized copies live in `content/.cache/media/`, keyed by a hash of the
 * source path — there is no index from a journal to its entries in there, so
 * the only way to be sure a deleted photograph leaves no derivative behind is
 * to drop the lot.
 *
 * That costs every other journal on the instance one re-resize per image, on
 * demand, which is what the cache is for. Somebody's pictures still sitting in
 * a cache directory after they asked for them to be deleted is not a trade
 * worth taking to save that.
 */
function dropMediaCache(): void {
  fs.rmSync(path.join(contentRoot(), ".cache", "media"), { recursive: true, force: true });
}

/**
 * A journal: the folder, and every row in the database that names it.
 *
 * **Iterated over `TABLE_NAMES` rather than written out table by table.** Two
 * of these cascade (`access_grants` and `push_subscriptions`, from
 * `contacts`); the rest key on `owner_id` and would be orphaned in silence.
 * Naming them individually here would be correct today and quietly wrong the
 * first time somebody adds a table — and the failure is invisible, which is
 * the worst kind. Reversed, so children go before the `users` rows they point
 * at.
 */
export async function deleteJournal(username: string, requestedBy: string): Promise<void> {
  const summary = summarise({ kind: "journal", username });
  const dir = userDir(username);
  // Rendered before the config is removed — afterwards there is no journal to
  // read a language off. See `Tombstone.notice`.
  const notice = goneNotice({ kind: "journal", username, title: summary?.title ?? username });

  const { db } = await getDatabase();
  for (const table of [...TABLE_NAMES].reverse()) {
    await sql`delete from ${sql.table(table)} where owner_id = ${username}`.execute(db);
  }

  for (const trip of getTrips(username)) forgetEntries(tripRef(username, trip.id));
  fs.rmSync(dir, { recursive: true, force: true });
  dropMediaCache();

  writeTombstone({
    kind: "journal",
    username,
    title: summary?.title ?? username,
    deletedAt: nowIso(),
    requestedBy,
    held: {
      trips: summary?.trips,
      days: summary?.days,
      files: summary?.files ?? 0,
      bytes: summary?.bytes ?? 0,
    },
    notice,
  });

  // Both caches key on the content root and would otherwise answer "yes, that
  // user exists" for the rest of this process's life.
  clearUserCache();
  clearConfigCache();
}

/**
 * A trip: the folder and everything in it, **including its `media/`**.
 *
 * A departure from day deletion, which explicitly leaves photographs on disk
 * so a day removed by mistake can be written again around the same pictures.
 * A trip taking its media with it is the right behaviour — there is nothing
 * left to write them into — but it is a difference, and it is said out loud in
 * the confirmation mail rather than discovered afterwards.
 */
export async function deleteTrip(
  username: string,
  tripId: string,
  requestedBy: string,
): Promise<void> {
  const ref = tripRef(username, tripId);
  const parsed = parseTripRef(ref);
  if (!parsed) throw new Error(`refusing to delete an unparseable trip ref: ${ref}`);
  const summary = summarise({ kind: "trip", username, tripId });
  const notice = goneNotice({
    kind: "trip",
    username,
    title: summary?.title ?? tripId,
    journalTitle: summary?.journalTitle,
  });

  const { db } = await getDatabase();
  // Every table that carries a `trip_id`, discovered rather than listed, for
  // the same reason the journal sweep iterates TABLE_NAMES: a list written out
  // here is a list that stops being true.
  const tables = await db.introspection.getTables();
  for (const table of tables) {
    if (!(TABLE_NAMES as readonly string[]).includes(table.name)) continue;
    // Bookkeeping, not content: `deletion_requests` carries a `trip_id` and
    // would otherwise sweep away the very row that authorised this call. A
    // second press of the same button would then read as "no such link"
    // instead of "you already used it", which is the less useful of the two
    // sentences. A journal deletion does take these rows, because then there
    // is no journal left for them to describe.
    if (table.name === "deletion_requests") continue;
    if (!table.columns.some((c) => c.name === "trip_id")) continue;
    await sql`delete from ${sql.table(table.name)} where owner_id = ${username} and trip_id = ${tripId}`.execute(db);
  }

  forgetEntries(ref);
  fs.rmSync(tripDir(ref), { recursive: true, force: true });
  dropMediaCache();

  writeTombstone({
    kind: "trip",
    username,
    tripId,
    title: summary?.title ?? tripId,
    deletedAt: nowIso(),
    requestedBy,
    held: { days: summary?.days, files: summary?.files ?? 0, bytes: summary?.bytes ?? 0 },
    notice,
  });
}
