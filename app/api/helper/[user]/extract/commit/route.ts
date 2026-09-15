import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { commitDay } from "@/lib/extract/commit";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { extendOnTouch } from "@/lib/staging/expiry";
import { readManifest, writeManifest } from "@/lib/staging/manifest";

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
 * All the real work — the quota, the move, the words, the `committed` flag —
 * is `lib/extract/commit.ts`'s own job; this route is the gate plus the
 * translation from a refusal to the right HTTP status.
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

  const { moved, entry } = await commitDay(user, body.run, body.date);

  // `moved` alone cannot tell "refused" from "a words-only day with every
  // photograph dropped, which is a real success" — both can carry `moved:
  // 0`. The manifest's own `committed` flag, re-read after the call, is
  // `commitDay`'s one honest signal of which happened, since its own return
  // shape is fixed and carries no reason.
  const after = readManifest(user, body.run);
  const row = after?.days.find((d) => d.date === body.date);
  if (!row?.committed) {
    return Response.json({ error: "day_not_ready" }, { status: 422 });
  }

  return Response.json({ ok: true, moved, entry }, { status: 200 });
}
