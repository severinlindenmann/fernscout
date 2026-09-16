import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { SPEECH_LANGUAGES, type SpeechLanguage } from "@/lib/helper/speech";
import { writeManifest } from "@/lib/staging/manifest";
import { newRunId } from "@/lib/staging/paths";
import { RUN_TTL_MS, sweepStaging } from "@/lib/staging/sweep";

export const dynamic = "force-dynamic";

/**
 * Open an import run — B1751.
 *
 * Cookie only, bearer refused: `isHelperOwner` is the gate every other route
 * under `app/api/helper/` uses, and this one stages hundreds of megabytes on
 * somebody's behalf.
 *
 * The sweep runs here rather than on a schedule. A run nobody returns to is
 * cleared by the next person who starts one, and on a one-owner instance that
 * is the same person — which is the whole of what this needs.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/start">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const now = new Date();
  sweepStaging(now);

  const body = (await request.json().catch(() => ({}))) as {
    tripId?: string;
    mode?: string;
    language?: string;
  };
  const runId = newRunId(now);
  const expiresAt = new Date(now.getTime() + RUN_TTL_MS).toISOString();
  const mode = body.mode === "voice" ? "voice" : "type";
  // Only a `"voice"` run was ever asked which language it speaks (Step 02's
  // mode screen, B1803 Task 4.1) — a `"type"` run has nothing to carry here,
  // same as `tripId`'s own "not supplied" shape above. An unsupported string
  // is dropped rather than rejected, matching `mode`'s own coercion just
  // above: the server's own default (the journal's locale, applied wherever
  // `language` is read back) is a safe fallback for a caller that sent
  // nothing recognised.
  const language: SpeechLanguage | undefined =
    mode === "voice" && SPEECH_LANGUAGES.includes(body.language as SpeechLanguage)
      ? (body.language as SpeechLanguage)
      : undefined;
  writeManifest(user, {
    version: 1,
    runId,
    owner: user,
    createdAt: now.toISOString(),
    expiresAt,
    tripId: typeof body.tripId === "string" && body.tripId !== "" ? body.tripId : null,
    mode,
    ...(language ? { language } : {}),
    state: "uploading",
    photos: [],
    days: [],
  });
  return Response.json({ runId, expiresAt });
}
