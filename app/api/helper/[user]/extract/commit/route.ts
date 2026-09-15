import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { commitDay } from "@/lib/extract/commit";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { extendOnTouch } from "@/lib/staging/expiry";
import { readManifest, writeManifest } from "@/lib/staging/manifest";
import { POST as assembleDay } from "@/app/api/helper/[user]/assemble-day/route";

export const dynamic = "force-dynamic";

/** The same shape `extract/run`'s own `PATCH` already checks `date` against
 *  before it can reach a `photo.date` that later names a directory —
 *  `date` reaches `lib/inbox.ts`'s day-folder helpers unvalidated by design
 *  (its own comment: "every caller already has it from a place that did"),
 *  and this route is that place. */
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Commit one confirmed day out of staging and into the journal — B1751, Task
 * 3.1. Same gates as every other route under `app/api/helper/[user]/extract/`
 * — `isEnabled`'s 404, then `isHelperOwner`'s cookie-only refusal — and the
 * same `extendOnTouch` touch every other authenticated read/write of a run
 * carries, so pressing this button never lets a run expire out from under
 * the person mid-press.
 *
 * All the real work — the quota, the move, the words, the trip, the
 * declines, the `committed` flag — is `lib/extract/commit.ts`'s own job;
 * this route is the gate plus the hand-off to `assemble-day`, which is the
 * one thing `commitDay` cannot do itself.
 *
 * **Why the hand-off lives here and not in `lib/`.** `assemble-day`'s create
 * logic is reachable only as its route's own `POST` handler — `isHelperOwner`,
 * `Response.json`, `RouteContext` all through it — and nothing in it is
 * exported separately. Extracting a reusable function out of somebody else's
 * working route was the larger move, and the smaller one that changes
 * nothing about it is available: call the real, already-tested handler
 * directly, the same way `app/api/web/**` routes already call an exported
 * function from their own `app/api/v2/**` counterparts. `isHelperOwner`
 * reads identity from Next's own per-request `cookies()`, not from whatever
 * `Request` object happens to be passed as an argument, so a freshly built
 * one carrying just `{ trip, date }` authenticates exactly as this request
 * already did — nothing is forwarded or re-checked, because nothing needs to
 * be.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/commit">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as { run?: string; date?: string } | null;
  if (!body || typeof body.run !== "string" || typeof body.date !== "string") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!DATE_RE.test(body.date)) {
    return Response.json({ error: "invalid_date", expected: "yyyy-mm-dd" }, { status: 400 });
  }

  const manifest = readManifest(user, body.run);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  const extended = extendOnTouch(manifest, new Date());
  if (extended) writeManifest(user, extended);

  const { moved } = await commitDay(user, body.run, body.date);

  // `moved` alone cannot tell "refused" from "a words-only day with every
  // photograph dropped, which is a real success" — both can carry `moved:
  // 0`. The manifest's own `committed` flag, re-read after the call, is
  // `commitDay`'s one honest signal of which happened, since its own return
  // shape is fixed and carries no reason. `tripId` is read from the same
  // fresh read: `commitDay` only ever sets `committed` once a trip exists,
  // so a truthy flag guarantees a truthy id.
  const after = readManifest(user, body.run);
  const row = after?.days.find((d) => d.date === body.date);
  if (!row?.committed || !after?.tripId) {
    return Response.json({ error: "day_not_ready" }, { status: 422 });
  }

  const assembled = await assembleDay(
    new Request("http://internal/assemble-day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: after.tripId, date: body.date }),
    }),
    { params: Promise.resolve({ user }) },
  );
  const assembledBody = (await assembled.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = typeof assembledBody?.slug === "string" ? assembledBody.slug : undefined;

  if (!assembled.ok || !slug) {
    // The day moved and every track it was never asked about is on record as
    // `unrecorded` — real, committed journal state — but the hand-off itself
    // did not produce an entry. Reported rather than hidden behind a generic
    // failure, on the same principle `assemble-day` itself uses when photos
    // attach but the entry does not: both halves of what actually happened.
    const handoffError = typeof assembledBody?.error === "string" ? assembledBody.error : "handoff_failed";
    return Response.json({ ok: true, moved, entry: null, handoffError }, { status: 200 });
  }

  // `assemble-day` itself reports a created entry whose photos did not
  // attach rather than hiding that partial success — carried through here
  // unchanged, same field name, so nothing downstream has to know this call
  // went through a second door to get here.
  const mediaError = typeof assembledBody?.mediaError === "string" ? assembledBody.mediaError : undefined;
  return Response.json(
    { ok: true, moved, entry: slug, ...(mediaError ? { mediaError } : {}) },
    { status: 200 },
  );
}
