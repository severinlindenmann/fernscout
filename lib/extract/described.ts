import "server-only";
import path from "node:path";
import { HELPER_MODEL } from "@/lib/helper/model";
import type { Described, DescribedForm } from "@/lib/photos/described";
import { describedBlock, describedFor, readSidecar, writeSidecar } from "@/lib/sidecar";
import { runDir } from "@/lib/staging/paths";

/**
 * A staged photograph's `described` block — B1866.
 *
 * The same sidecar shape a trip photograph keeps, for a file that is not on a
 * trip yet: the free sample and the paid enrich both look at the same picture,
 * and a person who took the sample and then paid should not be charged for a
 * description they have already been shown.
 *
 * In `meta/` beside `files/` rather than inside it, the same separation B1864
 * made on a trip: `runBytes` in `lib/staging/store.ts` sums `files/` to tell
 * somebody how much room the run is using, and a metadata file counted as
 * photograph bytes would make that number quietly wrong. `removeRun` deletes
 * the run directory whole, so nothing extra is needed to clean these up.
 */
function runSidecarPath(user: string, runId: string, photoId: string): string {
  return path.join(runDir(user, runId), "meta", `${path.basename(photoId)}.meta.json`);
}

/** What was already said about these exact bytes, or null. */
export function describedRunFile(
  user: string,
  runId: string,
  photoId: string,
  file: string,
  locales: readonly string[],
): Described | null {
  return describedFor(readSidecar(runSidecarPath(user, runId, photoId)), file, locales);
}

/** Keep what the model just said, so the next ask is free. */
export function rememberRunFile(
  user: string,
  runId: string,
  photoId: string,
  file: string,
  form: DescribedForm,
): void {
  writeSidecar(runSidecarPath(user, runId, photoId), {
    described: describedBlock(form, HELPER_MODEL, file),
  });
}
