import { NextResponse } from "next/server";
import { afterResponse } from "@/lib/afterResponse";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { isEnabled } from "@/lib/capabilities";
import {
  COMMENT_MAX_LENGTH,
  COMMENTS_PER_AUTHOR_PER_DAY,
  COMMENTS_SHOWN,
  addComment,
  commentsWrittenSince,
  deleteComment,
  editComment,
  getComment,
  listComments,
  type StoredComment,
} from "@/lib/comments";
import { isOwner, journalReader } from "@/lib/contacts/session";
import { getEntryBySlug } from "@/lib/entries";
import { journalPath } from "@/lib/journalPath";
import { listSubscriptions } from "@/lib/push";
import { localeForSubscriber, sendPush } from "@/lib/push/send";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { mayReadTrip, readerLevelFor } from "@/lib/tripGate";
import { getTrip, parseTripRef } from "@/lib/trips";
import type { Trip } from "@/lib/types";
import { getUser } from "@/lib/users";
import { translateIn } from "@/lib/locales";
import { readJsonBody } from "@/lib/api/jsonBody";

// Per-viewer data on every call — never prerender or cache it.
export const dynamic = "force-dynamic";

/**
 * Comments under a published day (B-2957).
 *
 * Reactions are anonymous; comments are not. Only the journal's owner and its
 * invited guests (a confirmed contact with a live grant) may read or write, and
 * the server decides on every call — the answer to anybody else, including a
 * browser holding only an identity cookie, is byte for byte the answer for a
 * trip that does not exist (`400 unknown_trip`), so there is nothing to tell
 * a stranger and nothing for a cache to hold.
 *
 * The author is the resolved session, never a field the client sends. The
 * author's email is stored to check ownership and is never returned; clients
 * get a display name and a server-computed `mine`.
 */

const NO_STORE = { "cache-control": "private, no-store", vary: "Cookie" };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });

const unknownTrip = () => json({ error: "unknown_trip" }, 400);

const disabled = () =>
  json(
    {
      error: "comments_disabled",
      message: "This journal does not have comments switched on. /api/health says which capabilities are on.",
    },
    404,
  );

type Viewer = { email: string; name: string; owner: boolean };
type Resolved =
  | { refusal: NextResponse }
  | { refusal?: undefined; trip: Trip; ref: string; day: string; viewer: Viewer; title: string };

/** The trip, the day and the viewer — or the one refusal to answer with. */
async function resolve(ref: unknown, day: unknown): Promise<Resolved> {
  const parsed = typeof ref === "string" ? parseTripRef(ref) : null;
  if (typeof ref !== "string" || !parsed) return { refusal: unknownTrip() };
  const user = getUser(parsed.username);
  if (!user || !isEnabled("comments", parsed.username)) return { refusal: disabled() };

  const trip = getTrip(ref);
  if (!trip || !(await mayReadTrip(trip))) return { refusal: unknownTrip() };

  const reader = await journalReader(parsed.username);
  const owner = await isOwner(parsed.username);
  // An identity cookie alone proves an address and grants nothing.
  if (!reader.email || !(owner || reader.guest)) return { refusal: unknownTrip() };

  const entry =
    typeof day === "string" && day
      ? getEntryBySlug(ref, day, { reader: await readerLevelFor(trip) })
      : undefined;
  if (!entry) return { refusal: unknownTrip() };

  const name = owner
    ? user.owner.name || user.owner.nickname || parsed.username
    : reader.contact?.name || "";
  return { trip, ref, day: entry.slug, title: entry.title, viewer: { email: reader.email, name, owner } };
}

function shape(c: StoredComment, viewer: Viewer) {
  return {
    id: c.id,
    author: c.authorName,
    body: c.body,
    at: c.createdAt,
    ...(c.editedAt ? { edited: true as const, editedAt: c.editedAt } : {}),
    mine: c.authorEmail === viewer.email,
  };
}

const limits = { maxLength: COMMENT_MAX_LENGTH, shown: COMMENTS_SHOWN, perAuthorPerDay: COMMENTS_PER_AUTHOR_PER_DAY };

function cleanBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body.length >= 1 && [...body].length <= COMMENT_MAX_LENGTH ? body : null;
}

async function readBody(request: Request) {
  const read = await readJsonBody(request);
  if (!read.ok) return { refusal: read.response as NextResponse };
  const body = read.value as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return { refusal: json({ error: "bad_json" }, 400) };
  return { body };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const r = await resolve(url.searchParams.get("trip"), url.searchParams.get("day"));
  if (r.refusal) return r.refusal;

  const all = url.searchParams.get("all") === "1";
  const { comments, total } = await listComments(r.ref, r.day, all ? undefined : COMMENTS_SHOWN);
  return json({
    comments: comments.map((c) => shape(c, r.viewer)),
    total,
    isOwner: r.viewer.owner,
    limits,
  });
}

export async function POST(request: Request) {
  if (foreignOrigin(request)) return json(FOREIGN_ORIGIN_REFUSAL, 403);
  const limit = rateLimitFor("comments", clientIp(request), { max: 10, windowMs: 60_000 });
  if (!limit.ok) return json({ error: "rate_limited", retryAfter: limit.retryAfter }, 429, { "retry-after": String(limit.retryAfter) });

  const read = await readBody(request);
  if (read.refusal) return read.refusal;
  const r = await resolve(read.body.trip, read.body.day);
  if (r.refusal) return r.refusal;

  const text = cleanBody(read.body.body);
  if (text === null) {
    return json({ error: "bad_body", message: `A comment is 1 to ${COMMENT_MAX_LENGTH} characters.`, limits }, 400);
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if ((await commentsWrittenSince(r.ref, r.viewer.email, since)) >= COMMENTS_PER_AUTHOR_PER_DAY) {
    return json({ error: "rate_limited", retryAfter: 3600 }, 429, { "retry-after": "3600" });
  }

  const saved = await addComment({
    tripId: r.ref,
    daySlug: r.day,
    authorEmail: r.viewer.email,
    authorName: r.viewer.name,
    body: text,
    createdAt: new Date().toISOString(),
  });

  // The owner's devices hear about a guest's comment — not their own, not the
  // text. Best effort: nothing here can fail the post.
  if (!r.viewer.owner) {
    const username = r.trip.username;
    const url = `${serverSite().url}${journalPath(username)}/trips/${r.trip.id}/day/${r.day}`;
    afterResponse("comment-push", async () => {
      try {
        const subs = (await listSubscriptions(username)).filter((s) => s.isOwner === true);
        const byLocale = new Map<string, typeof subs>();
        for (const sub of subs) {
          const locale = await localeForSubscriber(username, sub);
          byLocale.set(locale, [...(byLocale.get(locale) ?? []), sub]);
        }
        await Promise.all(
          [...byLocale].map(([locale, group]) =>
            sendPush({
              template: "news.push",
              subscriptions: group,
              title: getUser(username)?.title ?? username,
              body: translateIn(locale, "comments.push.body", { name: r.viewer.name || translateIn(locale, "comments.anonymous"), day: r.title }),
              url,
              tag: `comment-${r.day}`,
              locale,
            }),
          ),
        );
      } catch (err) {
        console.error("[comments] owner push failed", err instanceof Error ? err.message : err);
      }
    });
  }

  return json({ comment: shape(saved, r.viewer) }, 201);
}

export async function PATCH(request: Request) {
  if (foreignOrigin(request)) return json(FOREIGN_ORIGIN_REFUSAL, 403);
  const read = await readBody(request);
  if (read.refusal) return read.refusal;
  const r = await resolve(read.body.trip, read.body.day);
  if (r.refusal) return r.refusal;

  const text = cleanBody(read.body.body);
  if (text === null) {
    return json({ error: "bad_body", message: `A comment is 1 to ${COMMENT_MAX_LENGTH} characters.`, limits }, 400);
  }
  const id = typeof read.body.id === "string" ? read.body.id : "";
  const existing = id ? await getComment(r.ref, r.day, id) : null;
  if (!existing) return json({ error: "not_found" }, 404);
  // Only the author edits — the owner can delete someone's comment, not reword it.
  if (existing.authorEmail !== r.viewer.email) return json({ error: "forbidden" }, 403);

  const saved = await editComment(r.ref, r.day, id, text);
  if (!saved) return json({ error: "not_found" }, 404);
  return json({ comment: shape(saved, r.viewer) });
}

export async function DELETE(request: Request) {
  if (foreignOrigin(request)) return json(FOREIGN_ORIGIN_REFUSAL, 403);
  const read = await readBody(request);
  if (read.refusal) return read.refusal;
  const r = await resolve(read.body.trip, read.body.day);
  if (r.refusal) return r.refusal;

  const id = typeof read.body.id === "string" ? read.body.id : "";
  const existing = id ? await getComment(r.ref, r.day, id) : null;
  if (!existing) return json({ error: "not_found" }, 404);
  if (existing.authorEmail !== r.viewer.email && !r.viewer.owner) return json({ error: "forbidden" }, 403);

  await deleteComment(r.ref, r.day, id);
  return json({ deleted: id });
}
