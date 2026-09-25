import "server-only";
import { createHash } from "node:crypto";
import path from "node:path";
import { isEnabled } from "@/lib/capabilities";
import { creditsForPhotos } from "@/lib/helper/credits";
import { ledgerHasRef, refund, spend } from "@/lib/credits";
import { describeImage, HELPER_PROVIDER, type PhotoImage } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { describedRunFile, rememberRunFile } from "@/lib/extract/described";
import { defaultLocaleFor, localesFor } from "@/lib/locales";
import { resizedCopy } from "@/lib/media";
import { runDir } from "@/lib/staging/paths";
import { readManifest, writeManifest } from "@/lib/staging/manifest";
import { extendOnTouch } from "@/lib/staging/expiry";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/** Same width `day/describe-photos` and `studio/sample` already send. */
const PHOTO_WIDTH = 1080;

/** How many photographs are described at once — `day/describe-photos`'s own. */
const POOL = 3;

/** Where one staged photograph's bytes sit. */
function stagedPath(user: string, runId: string, photoId: string): string {
  return path.join(runDir(user, runId), "files", path.basename(photoId));
}

/**
 * Caption every photograph still in the run — the credits screen's paid
 * path, B1751 Task 4.1.
 *
 * **Written into the manifest, not into a real day.** The photographs here
 * are still staged — nothing has been committed yet — so a caption this
 * writes lands on the `PhotoRow` itself, exactly where a person's own chip
 * edit already lands (`PATCH .../studio/run`). `commitDay`
 * (`lib/extract/commit.ts`) carries a row's caption across through
 * `updateInboxMeta` once the day is built, so nothing further is needed to
 * make a paid-for caption reach the real gallery — but it also means the
 * caption is only as durable as the run: if the run expires before the
 * person commits, the caption goes with the staged files it describes, and
 * the credits that paid for it are not returned. That is the owner's own
 * decision, and it is why the credits screen says so above the spend button
 * rather than after it.
 *
 * **`ref` is `extract:<runId>:<photoSetHash>`** — Ruling R4, widened by
 * B1751 Task 4.3's R30. A run can now be reopened (this very task is what
 * makes that possible), and `ledgerHasRef`'s idempotency check used to be
 * keyed on the run alone: correct only while nothing could add photographs
 * to a run that had already been paid to describe. `photoSetHash` is a
 * stable hash of the live photo ids actually being described — order
 * independent, since only the *set* changed is meant to matter — so a
 * genuine double-tap on the same set still matches the same ref and is
 * still refused for free, while adding photographs and enriching again
 * produces a different ref and a real, second charge. `extract:<runId>`
 * stays the ref's prefix on purpose: `spentOnRun` in `lib/staging/expiry.ts`
 * reads the ledger by that prefix (not by exact match, since Task 4.3) to
 * tell somebody how many credits they are about to lose, and a ref that
 * stopped starting with it would make that warning silently report zero.
 *
 * Charged, then refunded on failure — the same order and the same reason
 * `day/describe-photos` already uses: the credit is spent before the model
 * is asked, because a call that never returns must not have been free, and
 * refunded when the model throws, because a credit that bought nothing is
 * not spent.
 */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Order-independent, so adding a photo and dropping it again lands back on
 *  the same ref rather than minting a new one for nothing. 12 hex characters
 *  is short of a full sha256 on purpose — this only has to distinguish sets
 *  within one run, not stand alone as an identifier. */
function photoSetHash(photoIds: string[]): string {
  return createHash("sha256").update([...photoIds].sort().join(",")).digest("hex").slice(0, 12);
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/studio/enrich">,
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
  const body = (jsonBody.value) as Record<string, unknown> | null;
  const runId = text(body?.run);
  if (!runId) return Response.json({ error: "invalid_body" }, { status: 400 });

  const manifest = readManifest(user, runId);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  const extended = extendOnTouch(manifest, new Date());
  const current = extended ?? manifest;

  // Every photograph still in the run and not dropped — the same population
  // the credits screen priced when it showed this button.
  const live = current.photos.filter((p) => p.kind === "image" && !p.dropped);
  if (live.length === 0) return Response.json({ error: "no_photos" }, { status: 400 });

  const locales = localesFor(user);
  const locale = defaultLocaleFor(user);

  // What is already described — by an earlier enrich, or by this run's one
  // free sample — is answered from beside the file and never sent again
  // (B1866), so only the rest is priced. All cached is zero credits and no
  // spend at all.
  const uncached = live.filter(
    (photo) =>
      !describedRunFile(user, runId, photo.id, stagedPath(user, runId, photo.id), locales),
  );
  const credits = creditsForPhotos(uncached.length);
  const ref = `extract:${runId}:${photoSetHash(live.map((p) => p.id))}`;

  // A double-tap — a slow connection, a phone that has not visibly
  // responded yet — must not charge twice. `ledgerHasRef` is the same
  // idempotency check `storage/route.ts` already uses for its own purchase:
  // a real row for this exact (owner, reason, ref) already exists, so this
  // is a retry of a spend that already happened, not a new one. Answered as
  // the same successful shape the first call gave, computed from what is
  // actually on the manifest now, rather than a 402 or a second charge —
  // a retry of a purchase that went through should look like the purchase
  // it was, not like a failure that invites a third attempt.
  //
  // **This checks per PHOTO SET, not per RUN — B1751 Task 4.3, R30.** A
  // legitimate second `enrich` on the same run, after the person resumed it
  // and added more photographs, hashes to a different `ref` and is charged
  // and captioned for real. A true double-tap — same run, same live photos —
  // hashes to the same `ref` it did the first time and is still answered for
  // free, from what is already on the manifest.
  if (await ledgerHasRef(user, "helper", ref)) {
    const captioned = live.filter((p) => Boolean(p.caption)).length;
    return Response.json({ ok: true, spent: credits, captioned, provider: HELPER_PROVIDER });
  }

  if (credits > 0 && !(await spend(user, credits, "helper", ref))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  try {
    let captioned = 0;
    // Only photographs actually sent to the model, for the same reason
    // `day/describe-photos` counts one — B1795. `captioned` above also
    // counts a cache hit, so it cannot tell "nothing new happened" from
    // "everything was already described"; this can.
    let sent = 0;
    // Three at a time, the same pool `day/describe-photos` uses. Each answer
    // is kept beside its file the moment it arrives, so a throw part-way
    // through still leaves everything already described free next time.
    for (let i = 0; i < live.length; i += POOL) {
      const results = await Promise.allSettled(
        live.slice(i, i + POOL).map(async (photo) => {
          const file = stagedPath(user, runId, photo.id);
          let caption = describedRunFile(user, runId, photo.id, file, locales)?.caption[locale];
          if (caption === undefined) {
            const resized = await resizedCopy(file, PHOTO_WIDTH);
            // An unreadable file is not captioned and was never charged for.
            if (!resized) return;
            const image: PhotoImage = { base64: resized.toString("base64"), mediaType: "image/webp" };
            const form = await describeImage(image, user, locales);
            rememberRunFile(user, runId, photo.id, file, form);
            caption = form.caption[locale] ?? "";
            sent += 1;
          }
          photo.caption = caption.trim();
          captioned += 1;
        }),
      );
      // `allSettled` rather than `all` so a sibling failure is not an
      // unhandled rejection; the first one still decides this answer.
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;
    }
    // Every photograph that needed sending failed to resize: the model was
    // never asked anything, so the spend above bought nothing. Thrown, not
    // returned directly, so it takes the same refund path a model failure
    // already does — one policy, whichever reason nothing got described.
    if (uncached.length > 0 && sent === 0) {
      throw new Error("every photograph failed to resize");
    }

    writeManifest(user, current);

    const answer = { ok: true, spent: credits, captioned, provider: HELPER_PROVIDER };
    return Response.json(answer);
  } catch {
    // The credit bought nothing; give it back — the whole spend, because the
    // spend was priced whole; a photograph described before the throw is
    // cached now and is free on the retry. The same stance
    // `day/describe-photos` takes, and for the same reason: what a provider
    // says when it is unhappy is not something to render on somebody's
    // phone.
    if (credits > 0) await refund(user, credits, ref);
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
}
