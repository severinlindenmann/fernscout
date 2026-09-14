import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { readExif, isoDate, isoTime } from "@/lib/ingest/exif";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * The B1750 phone-upload probe — throwaway, and meant to be deleted.
 *
 * B1751 rests on three unverified claims about phones: that EXIF survives a
 * `<input type="file">` pick, that a few hundred files go through at once, and
 * that a PWA can finish the upload in the background. None of them can be
 * answered from a laptop. This route plus `public/probe.html` is the smallest
 * thing that answers them from a real handset: pick photographs, upload, and
 * the server says what actually arrived.
 *
 * **Not a capability.** It is gated on `PROBE_TOKEN` being set in the
 * environment and matching `?k=`, and answers 404 when the variable is absent
 * — so it does not exist on any instance that has not deliberately switched it
 * on, and adding it to `FEATURE_NAMES` for a probe that gets deleted next week
 * would be a permanent entry for a temporary thing.
 *
 * Nothing here touches a journal. Uploads land in `PROBE_DIR` (default
 * `/tmp/fernscout-probe`), outside `content/` and outside the storage quota,
 * and anything older than `MAX_AGE_MS` is deleted on the next request. That is
 * the POC's version of B1751's 48h temporary store: a sweep on write, because
 * a probe does not earn a scheduler.
 */

const MAX_AGE_MS = 48 * 60 * 60 * 1000;
/** Per file. Bigger than any phone photograph, smaller than a video. */
const MAX_FILE_BYTES = 80 * 1024 * 1024;
/** Per request — the page uploads in batches, so this is a batch, not a run. */
const MAX_FILES_PER_REQUEST = 60;

function probeDir(): string {
  return process.env.PROBE_DIR ?? "/tmp/fernscout-probe";
}

/** Delete whole run directories older than two days. Best-effort: a probe that
 *  cannot tidy up is still a probe that can answer the question. */
async function sweep(root: string, now: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(root, name);
    try {
      const info = await stat(path);
      if (now - info.mtimeMs > MAX_AGE_MS) await rm(path, { recursive: true, force: true });
    } catch {
      // Raced with another request's sweep, or unreadable. Either way, not ours.
    }
  }
}

/**
 * What the container says it is, from its own first bytes.
 *
 * The question behind it is the one the whole probe exists for: iOS hands over
 * either the HEIC the camera wrote or a JPEG Safari transcoded on the way out,
 * and the two are indistinguishable from the filename. A `jpeg` here under a
 * `.HEIC` name is a re-encode, and a re-encode is where EXIF goes to die.
 */
function containerOf(bytes: Uint8Array): string {
  if (bytes.length < 12) return "too-short";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  const brand = new TextDecoder().decode(bytes.subarray(4, 12));
  if (brand.startsWith("ftyp")) return `heif:${brand.slice(4).trim()}`;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  const riff = new TextDecoder().decode(bytes.subarray(0, 4));
  if (riff === "RIFF") return "webp-or-riff";
  return "unknown";
}

export async function POST(request: Request) {
  const expected = process.env.PROBE_TOKEN;
  if (!expected) return NextResponse.json({ error: "probe_disabled" }, { status: 404 });

  const url = new URL(request.url);
  if (url.searchParams.get("k") !== expected) {
    return NextResponse.json({ error: "probe_disabled" }, { status: 404 });
  }

  // Loose, because the point is to find the ceiling rather than to impose one:
  // a phone sending three hundred photographs in batches of sixty is five
  // requests, and a script hammering the box is thousands.
  const limit = rateLimitFor("probe-upload", clientIp(request), { max: 120, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    // Worth reporting rather than swallowing: "the request died at 300 files"
    // is one of the three findings this ticket is for.
    return NextResponse.json(
      { error: "body_unreadable", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const runId = (form.get("run") ?? "").toString().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  if (!runId) return NextResponse.json({ error: "run_missing" }, { status: 400 });

  const root = probeDir();
  const now = Date.now();
  await sweep(root, now);
  const dir = join(root, runId);
  await mkdir(dir, { recursive: true });

  const files = form.getAll("file").filter((v): v is File => v instanceof File);
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: "too_many_files", max: MAX_FILES_PER_REQUEST, got: files.length },
      { status: 413 },
    );
  }

  const report: unknown[] = [];
  for (const [index, file] of files.entries()) {
    const base = {
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
    };
    if (file.size > MAX_FILE_BYTES) {
      report.push({ ...base, skipped: "too_large" });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const exif = readExif(bytes);
    report.push({
      ...base,
      container: containerOf(bytes),
      exif: {
        // Spelled out rather than spread, so a missing key in the response is
        // a tag the phone did not send rather than one this route forgot.
        takenAt: exif.takenAt ? `${isoDate(exif.takenAt)}T${isoTime(exif.takenAt)}` : null,
        offset: exif.offset ?? null,
        lat: exif.lat ?? null,
        lng: exif.lng ?? null,
        altitude: exif.altitude ?? null,
        orientation: exif.orientation ?? null,
        make: exif.make ?? null,
        model: exif.model ?? null,
      },
      hasGps: exif.lat !== undefined && exif.lng !== undefined,
      hasTakenAt: exif.takenAt !== undefined,
    });
    // Keep the original. The metadata above answers most of the question, but
    // "Safari stripped the maker note and re-encoded at 92%" is only knowable
    // from the file itself, and re-uploading from the phone to find out costs
    // another trip to a handset.
    const safe = `${String(index).padStart(4, "0")}-${file.name.replace(/[^\w.-]/g, "_")}`;
    await writeFile(join(dir, safe.slice(0, 120)), bytes);
  }

  // Whatever the page learned about its own platform, kept beside the files it
  // describes: the support matrix is half the finding and the server cannot
  // observe it.
  const client = form.get("client");
  if (typeof client === "string") {
    await writeFile(join(dir, `client-${now}.json`), client);
  }

  await writeFile(
    join(dir, `report-${now}.json`),
    JSON.stringify({ at: new Date(now).toISOString(), count: files.length, report }, null, 2),
  );

  return NextResponse.json({ ok: true, run: runId, count: files.length, report });
}
