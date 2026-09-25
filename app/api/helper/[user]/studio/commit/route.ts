import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { commitDay, titleForDay } from "@/lib/extract/commit";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { extendOnTouch } from "@/lib/staging/expiry";
import { DATE_RE, readManifest, writeManifest } from "@/lib/staging/manifest";
import { POST as assembleDay } from "@/app/api/helper/[user]/assemble-day/route";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * Commit one confirmed day out of staging and into the journal — B1751, Task
 * 3.1. Same gates as every other route under `app/api/helper/[user]/studio/`
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
  { params }: RouteContext<"/api/helper/[user]/studio/commit">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as { run?: string; date?: string } | null;
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

  // A retried commit (a double-click, a network retry, a restored tab)
  // reaches here too — `commitDay` moved nothing a second time, but this
  // route would otherwise call `assemble-day` again regardless, onto a day
  // folder its own first, successful call already deleted. `createDraft`'s
  // own collision check is by slug, not by date, so that second call would
  // either refuse on an empty folder or, worse, mint a second entry for the
  // same date — the exact bug this fix exists to close. `row.entrySlug`,
  // written below the first time this succeeds, is what lets this call
  // recognise its own earlier success and stop here: the same successful
  // shape, with the real slug a preview can still link to.
  if (row.entrySlug) {
    return Response.json({ ok: true, moved, entry: row.entrySlug }, { status: 200 });
  }

  // B2081 — the day lands titled (its place, or its date in words), so its
  // slug and its photographs' folder say which day it is. A place a second
  // day of the same trip already holds would be refused as `slug_taken`;
  // the date, unique within the trip, is asked for instead.
  const assemble = async (title: string) => {
    const res = await assembleDay(
      new Request("http://internal/assemble-day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: after.tripId, date: body.date, title }),
      }),
      { params: Promise.resolve({ user }) },
    );
    return { res, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  const byPlace = titleForDay(row.location, body.date);
  let { res: assembled, json: assembledBody } = await assemble(byPlace);
  const byDate = titleForDay(undefined, body.date);
  if (assembledBody?.error === "slug_taken" && byPlace !== byDate) {
    ({ res: assembled, json: assembledBody } = await assemble(byDate));
  }
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

  // The one write this route makes itself, rather than through
  // `commitDay` or `assemble-day`: recording the slug on the manifest's own
  // row is what makes the short-circuit above possible, and it happens only
  // once, right after the call that actually produced it.
  row.entrySlug = slug;
  writeManifest(user, after);

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
