import "server-only";
import path from "node:path";
import { isEnabled } from "@/lib/capabilities";
import { mayUseAi } from "@paid/credits/lib/aiDays";
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
 * Caption every photograph still in the run — B1751 Task 4.1.
 *
 * **Written into the manifest, not into a real day.** The photographs here
 * are still staged — nothing has been committed yet — so a caption this
 * writes lands on the `PhotoRow` itself, exactly where a person's own chip
 * edit already lands (`PATCH .../studio/run`). `commitDay`
 * (`lib/extract/commit.ts`) carries a row's caption across through
 * `updateInboxMeta` once the day is built, so nothing further is needed to
 * make a caption reach the real gallery — but it also means the caption is
 * only as durable as the run: if the run expires before the person commits,
 * the caption goes with the staged files it describes.
 *
 * **B2591 — no AI day of its own.** This needs an active plan or unused
 * Free days (`mayUseAi`, `@paid/credits/lib/aiDays.ts`) but takes nothing;
 * nothing is charged or given back. `describedRunFile`'s own per-photo
 * cache is what keeps a genuine double-tap from reaching the model a second
 * time (B1751 Task 4.3's R30).
 */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

  // Every photograph still in the run and not dropped.
  const live = current.photos.filter((p) => p.kind === "image" && !p.dropped);
  if (live.length === 0) return Response.json({ error: "no_photos" }, { status: 400 });

  const locales = localesFor(user);
  const locale = defaultLocaleFor(user);

  // What is already described — by an earlier enrich, or by this run's one
  // free sample — is answered from beside the file and never sent again
  // (B1866), so only the rest ever reaches the model or the AI-day gate.
  const uncached = live.filter(
    (photo) =>
      !describedRunFile(user, runId, photo.id, stagedPath(user, runId, photo.id), locales),
  );

  // B2591 — "enrich" takes no AI day of its own; it just needs an active
  // plan or unused Free days, the same gate `ask`, `transcribe`, `statement`
  // and the two "people from a photo" routes share. Only checked when there
  // is something new to send — `describedRunFile`'s own per-photo cache is
  // what keeps a genuine double-tap from reaching the model a second time.
  if (uncached.length > 0) {
    const gate = await mayUseAi(user);
    if (!gate.ok) return Response.json(gate.refusal, { status: 402 });
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
    // never asked anything. Thrown, not returned directly, so it takes the
    // same "caught below" path a model failure already does — one policy,
    // whichever reason nothing got described.
    if (uncached.length > 0 && sent === 0) {
      throw new Error("every photograph failed to resize");
    }

    writeManifest(user, current);

    const answer = { ok: true, captioned, provider: HELPER_PROVIDER };
    return Response.json(answer);
  } catch {
    // Nothing was charged, so there is nothing to give back — a photograph
    // described before the throw is cached now and is free on the retry, the
    // same stance `day/describe-photos` takes. What a provider says when it
    // is unhappy is not something to render on somebody's phone.
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
}
