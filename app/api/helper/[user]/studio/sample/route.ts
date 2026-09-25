import "server-only";
import path from "node:path";
import { isEnabled } from "@/lib/capabilities";
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
  { params }: RouteContext<"/api/helper/[user]/studio/sample">,
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
  const locales = localesFor(user);

  // Kept beside the run file, and read back here first — B1866. The sample is
  // free, so this saves nothing on this call; what it saves is the *next* one,
  // because `extract/enrich` reads the same block and does not charge for a
  // photograph that already has one.
  const locale = defaultLocaleFor(user);
  let caption = describedRunFile(user, runId, photo.id, file, locales)?.caption[locale];
  if (caption === undefined) {
    const resized = await resizedCopy(file, PHOTO_WIDTH);
    if (!resized) return Response.json({ error: "unreadable_photo" }, { status: 422 });
    const image: PhotoImage = { base64: resized.toString("base64"), mediaType: "image/webp" };
    const form = await describeImage(image, user, locales);
    rememberRunFile(user, runId, photo.id, file, form);
    caption = form.caption[locale] ?? "";
  }

  // Written once the answer is in hand: a retry after a thin caption would
  // not be a second free sample, it would be the same one shown differently.
  // An answer with no caption at all never gets here — `describeImage`
  // refuses it (B1923) and this route throws, so the sample is not spent.
  current.sampleTakenFor = runId;
  writeManifest(user, current);

  return Response.json({ caption, provider: HELPER_PROVIDER });
}
