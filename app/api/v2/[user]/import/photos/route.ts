// GET/POST /api/v2/{user}/import/photos — B2195.
//
// The bearer twin of the studio's cookie-only staging door
// (`POST /api/helper/<user>/studio/upload`), for the iPhone share sheet:
// "start a new trip from these". One implementation — `stageFiles` — and the
// same run manifest, so the studio's guided import resumes what lands here.
// Nothing is filed: trip and day are declined, the owner decides both in the
// studio, and staged photographs clear after the studio's own two-day rule.
//
// Owner token only: a trip-scoped token is refused, and `resolveBearer`
// without `allowGpsWrite` already refuses `write:gps`.
import { isEnabled } from "@/lib/capabilities";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { ownerOnlyRefusal, mayActAsOwner, outOfScopeRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { extendOnTouch } from "@/lib/staging/expiry";
import { listRuns, readManifest, writeManifest, type RunManifest } from "@/lib/staging/manifest";
import { newRunId } from "@/lib/staging/paths";
import { MAX_FILES_PER_REQUEST, MAX_FILES_PER_RUN, stageFiles } from "@/lib/staging/stageFiles";
import { RUN_TTL_MS, sweepStaging } from "@/lib/staging/sweep";
import { journalStagingBytes } from "@/lib/staging/store";
import { IMAGE_MAX_BYTES, JOURNAL_STAGING_MAX_BYTES, REQUEST_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

const LIMITS = {
  maxFilesPerRequest: MAX_FILES_PER_REQUEST,
  maxFilesPerRun: MAX_FILES_PER_RUN,
  imageBytes: IMAGE_MAX_BYTES,
  videoBytes: VIDEO_MAX_BYTES,
  stagedLimitBytes: JOURNAL_STAGING_MAX_BYTES,
};

async function gate(request: Request, user: string) {
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();
  // Absent, not broken, when the guided import is off.
  if (!isEnabled("extract", user)) return fail("not_found", ERROR_CODES.not_found, undefined, 404);
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ user: string }> }) {
  const { user } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;
  return ok({
    ...LIMITS,
    stagedBytes: journalStagingBytes(user),
    runs: listRuns(user).map((r) => ({
      runId: r.runId,
      photos: r.photos.length,
      expiresAt: r.expiresAt,
      ...(r.via ? { via: r.via } : {}),
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ user: string }> }) {
  const { user } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REQUEST_MAX_BYTES) {
    return fail("body_too_large", ERROR_CODES.body_too_large, { maxBytes: REQUEST_MAX_BYTES }, 413);
  }
  const form = await request.formData().catch(() => null);
  if (!form) return fail("expected_multipart", ERROR_CODES.expected_multipart, undefined, 400);

  const files = form.getAll("file").filter((v): v is File => v instanceof File);
  if (files.length > MAX_FILES_PER_REQUEST) {
    return fail(
      "body_too_large",
      `${ERROR_CODES.body_too_large} At most ${MAX_FILES_PER_REQUEST} files per request.`,
      { max: MAX_FILES_PER_REQUEST, got: files.length },
      413,
    );
  }

  // `run` names a run to add to; absent opens a new one — new trip, typed.
  // No files at all is allowed: it only opens the run, which is how the share
  // sheet gets a runId to put on every background upload that follows.
  const runId = String(form.get("run") ?? "");
  let current: RunManifest;
  if (runId) {
    const manifest = readManifest(user, runId);
    if (!manifest) return fail("not_found", "No such run for this journal.", undefined, 404);
    // Continuing a run is how somebody extends it, as in the studio door.
    const extended = extendOnTouch(manifest, new Date());
    if (extended) writeManifest(user, extended);
    current = extended ?? manifest;
  } else {
    const now = new Date();
    sweepStaging(now);
    current = {
      version: 1 as const,
      runId: newRunId(now),
      owner: user,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RUN_TTL_MS).toISOString(),
      tripId: null,
      mode: "type" as const,
      state: "uploading" as const,
      via: "share" as const,
      photos: [],
      days: [],
    };
  }

  const { accepted, rejected, stagedBytes } = await stageFiles(user, current, files);
  // Background uploads arrive in parallel, each having read the manifest
  // before its own awaits. Re-read it here, with nothing awaited between
  // this read and the write, so one request cannot overwrite another's rows.
  const latest = readManifest(user, current.runId) ?? current;
  const have = new Set(latest.photos.map((p) => p.id));
  latest.photos.push(...accepted.filter((p) => !have.has(p.id)));
  writeManifest(user, latest);
  return ok({
    runId: current.runId,
    expiresAt: current.expiresAt,
    accepted: accepted.map(({ id, filename, bytes, kind }) => ({ id, filename, bytes, kind })),
    rejected,
    stagedBytes,
    ...LIMITS,
  });
}
