import "server-only";
import path from "node:path";
import { isEnabled } from "@/lib/capabilities";
import { describePhotos, HELPER_PROVIDER, type PhotoImage } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { defaultLocaleFor } from "@/lib/locales";
import { resizedCopy } from "@/lib/media";
import { runDir } from "@/lib/staging/paths";
import { readManifest, writeManifest } from "@/lib/staging/manifest";
import { extendOnTouch } from "@/lib/staging/expiry";

export const dynamic = "force-dynamic";

/**
 * One free caption, once per run — B1751, Task 4.1.
 *
 * The sequencing this whole task exists for: before anybody is shown a
 * price, they are shown one real result. `sampleTakenFor` on the manifest
 * is what stops a second one — the run id is the natural key, since this is
 * a taste of the feature rather than a free tier a script could loop on.
 * Nothing here touches the credit ledger: a row for a free thing would be a
 * lie about the balance, and the abuse control is one-per-run rather than a
 * rate limit.
 *
 * The same shape as `day/describe-photos` next door, narrowed to one
 * photograph: cookie-only (`isHelperOwner`), a 404 with the capability off,
 * and a resized derivative sent to the model rather than the original —
 * `PHOTO_WIDTH` matches that route's own.
 */
const PHOTO_WIDTH = 1080;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/sample">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const runId = text(body?.run);
  const photoId = text(body?.photoId);
  if (!runId || !photoId) return Response.json({ error: "invalid_body" }, { status: 400 });

  const manifest = readManifest(user, runId);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  // Checked before the photograph is even looked up: a second request for
  // this run answers the same way whether or not `photoId` is real, because
  // the rule is about the run having already had its one taste, not about
  // this particular picture.
  if (manifest.sampleTakenFor) {
    return Response.json({ error: "sample_already_taken" }, { status: 409 });
  }

  const photo = manifest.photos.find((p) => p.id === photoId);
  if (!photo || photo.kind !== "image") {
    return Response.json({ error: "no_such_photo" }, { status: 404 });
  }

  const extended = extendOnTouch(manifest, new Date());
  const current = extended ?? manifest;

  const file = path.join(runDir(user, runId), "files", path.basename(photo.id));
  const resized = await resizedCopy(file, PHOTO_WIDTH);
  if (!resized) return Response.json({ error: "unreadable_photo" }, { status: 422 });

  const image: PhotoImage = { base64: resized.toString("base64"), mediaType: "image/webp" };
  const [caption] = await describePhotos([image], user, defaultLocaleFor(user));

  // Written whether or not the model actually had anything to say — an
  // empty caption is still a real, honest taste of the feature, and a
  // retry after an empty answer would not be a second free sample, it would
  // be the same one shown differently.
  current.sampleTakenFor = runId;
  writeManifest(user, current);

  return Response.json({ caption: caption ?? "", provider: HELPER_PROVIDER });
}
