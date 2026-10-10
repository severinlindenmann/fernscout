import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { extendOnTouch } from "@/lib/staging/expiry";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { MAX_FILES_PER_REQUEST, stageAndAppend } from "@/lib/staging/stageFiles";
import { readManifest, writeManifest } from "@/lib/staging/manifest";
import { JOURNAL_STAGING_MAX_BYTES } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/studio/upload">,
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

  const { accepted, rejected, stagedBytes } = await stageAndAppend(user, current, files);
  return Response.json({
    runId,
    accepted,
    rejected,
    stagedBytes,
    stagedLimitBytes: JOURNAL_STAGING_MAX_BYTES,
  });
}
