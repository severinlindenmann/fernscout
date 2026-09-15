import "server-only";
import path from "node:path";
import { isEnabled } from "@/lib/capabilities";
import { analyseStaged } from "@/lib/extract/analyse";
import { extendOnTouch } from "@/lib/staging/expiry";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { VIDEO_EXTENSIONS } from "@/lib/ingest/video";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { readManifest, writeManifest, type PhotoRow } from "@/lib/staging/manifest";
import { putStagedFile } from "@/lib/staging/store";
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

/** One request is one batch, not one run. The page sends ten; sixty is the
 *  ceiling so a retry of a big batch still fits in one request. */
const MAX_FILES_PER_REQUEST = 60;
/** The whole run. Past this the honest answer is "do it in two trips", which
 *  beats a run nobody can finish in one sitting. */
export const MAX_FILES_PER_RUN = 500;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/upload">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const limit = rateLimitFor("extract-upload", clientIp(request), { max: 120, windowMs: 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    // Reported rather than swallowed: "the request died at file 30" is a thing
    // the page has to be able to tell somebody, and a proxy cutting an
    // oversized body looks identical from the browser to a dropped signal.
    return Response.json(
      { error: "body_unreadable", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const runId = String(form.get("run") ?? "");
  const manifest = readManifest(user, runId);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  // Continuing a run *is* how somebody extends it — there is no button.
  const extended = extendOnTouch(manifest, new Date());
  if (extended) writeManifest(user, extended);
  const current = extended ?? manifest;

  const files = form.getAll("file").filter((v): v is File => v instanceof File);
  if (files.length > MAX_FILES_PER_REQUEST) {
    return Response.json(
      { error: "too_many_files", max: MAX_FILES_PER_REQUEST, got: files.length },
      { status: 413 },
    );
  }

  const accepted: PhotoRow[] = [];
  const rejected: { filename: string; reason: string }[] = [];
  for (const file of files) {
    if (current.photos.length + accepted.length >= MAX_FILES_PER_RUN) {
      rejected.push({ filename: file.name, reason: "run_full" });
      continue;
    }
    const isVideo = VIDEO_EXTENSIONS.has(path.extname(file.name).toLowerCase());
    if (file.size > (isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES)) {
      rejected.push({ filename: file.name, reason: "too_large" });
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = putStagedFile(user, runId, file.name, bytes);
    // Content-addressed, so a retried batch is idempotent: the same photograph
    // twice is one row, and the page's retry button cannot double a day.
    if (current.photos.some((p) => p.id === stored.id)) continue;
    accepted.push(analyseStaged(stored, bytes));
  }

  current.photos.push(...accepted);
  writeManifest(user, current);
  return Response.json({ runId, accepted, rejected });
}
