import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { contentHash } from "./ingest/hash";
import { perceptualHashOf } from "./ingest/image";
import { measureImage, type ImageFacts } from "./ingest/imageFacts";
import { tripMediaDir, tripMetaDir, tripSidecarPath } from "./media";
import {
  DESCRIBED_SCHEMA_VERSION,
  parseDescribed,
  type Described,
  type DescribedForm,
} from "./photos/described";
import type { InboxKind } from "./inbox";
import type { PhotoVisibility } from "./photos";

/**
 * One metadata file per photograph, for life — B1864.
 *
 * A photograph used to have two unrelated sidecar shapes that knew nothing of
 * each other: `MediaSidecar` in `lib/api/v2/media.ts` (six fields, written
 * once at the v2 media door) and `InboxMeta` in `lib/inbox.ts` (much richer).
 * Both rebuilt the file from their own type on every write, so the older
 * writer silently erased whatever the other knew, and both used
 * `writeFileSync` straight onto the final path — in a synced folder, a
 * documented way to a half-written file.
 *
 * So: one shape, one reader, one writer, and the writer **reads, merges, and
 * renames a temp file into place**. Every key it did not know about survives.
 * Nothing anywhere else in this repository writes a sidecar.
 *
 * The file also *moves* rather than being rebuilt. Created at whichever door
 * the bytes first arrive (the v2 media door, v1 `storeUploads`, the inbox),
 * it is carried whole onto the trip when the photograph is filed —
 * `moveSidecar` — with `trip`/`day`/`source` merged over it and the inbox
 * copy unlinked in the same step. Afterwards exactly one file exists.
 *
 * **Nothing on a sidecar is inferred.** `description`, `lat`, `lon`,
 * `takenAt`, `caption` and `tags` are what somebody said, and are absent when
 * nobody said anything — AGENTS.md's one rule, at the door where it is
 * cheapest to break: a plausible description of a photograph is exactly the
 * kind of invention nobody catches. `measuredFrom` is the single named
 * exception and it says so in its own field.
 *
 * Where they live: a trip's sidecars are under `trips/<trip>/meta/…`, a
 * sibling of `media/` that `resolveMediaFile` cannot reach (B1863); the inbox
 * keeps its own beside the bytes it is holding.
 */
export type Sidecar = {
  /** The name the uploader used, kept so a person recognises their own file. */
  filename?: string;
  bytes?: number;
  /**
   * The full hex sha256 of the **original** bytes — the repair handle.
   *
   * Full, not the 32-character prefix a v2 derivative is named after, and
   * present on a trip sidecar as much as an inbox one: v1 filenames are
   * positional (`01.jpg`) and carry no hash at all, so without this there is
   * nothing tying a derivative, its original and this file to one photograph.
   */
  sha256?: string;
  uploadedAt?: string;
  /** Whatever identity the door resolved — an email, or a token's label.
   * Absent when the door genuinely had none; never invented. */
  uploadedBy?: string;
  /**
   * Which door the bytes came through. Absent means the ordinary web upload,
   * as it did when this field only ever said `"whatsapp"` (B1059).
   */
  source?: SidecarSource;
  /**
   * The inbox kind, which is **where the file actually is**, never what the
   * file claims: a sidecar edited by hand must not be able to move a file
   * between folders by saying so. `lib/inbox.ts` overwrites it on every read.
   */
  kind?: InboxKind;
  trip?: string;
  day?: string;
  caption?: string;
  description?: string;
  /**
   * Whether the conversation has already asked for a caption on this
   * photograph and been told no — mirrors `Entry.weatherAsked` exactly.
   * Absent means not asked yet; `caption` present means answered.
   */
  descriptionAsked?: boolean;
  tags?: string[];
  lat?: number;
  lon?: number;
  takenAt?: string;
  /**
   * A named exception to "nothing on a sidecar is inferred". `"exif"` means
   * `lat`/`lon`/`takenAt` came from the photograph's own embedded metadata, a
   * real measurement the camera took, not a guess and not what the person
   * said. `"probe"` is the same claim for a video clip — read by `ffprobe`
   * off its container tags (B1852) rather than EXIF, which a video file has
   * none of — so it gets its own word instead of overloading "exif" for a
   * reader that checks provenance by string. Every reader that might
   * otherwise credit these fields to the uploader must check this first.
   */
  measuredFrom?: "exif" | "probe";
  /**
   * The uploaded file's own pixel size — measured, never said, and unlike
   * `measuredFrom` this one needs no flag: a width and a height are never
   * somebody's opinion. Written once at upload time (`lib/inboxUpload.ts`,
   * B1995) by reading the header only (`sharp(bytes).metadata()`, which
   * answers even for a HEIC no decoder on this machine could open a pixel
   * of), so an inbox tile can show it without decoding the file again on
   * every page load. Absent for a video, and for anything sharp's header
   * reader itself does not recognise — a tile is not worse off for not
   * knowing, it just shows the date alone.
   */
  dimensions?: { width: number; height: number };
  /**
   * A place name for a `location`-kind item, or for a `media` photograph
   * whose EXIF carried coordinates — from a reverse-geocode lookup, never
   * typed by a person, never guessed by an agent. Absent when the
   * `addressLookup` capability is off, or the lookup found nothing.
   */
  location?: string;
  country?: string;
  /**
   * Which lookup named `location`/`country` — B2189. `"offline"` is the
   * packed place index (`lib/ingest/geo.ts`, the same one `placeForDay`
   * uses): a photograph's EXIF coordinates never leave the server for it.
   * `"addressLookup"` is the configured third-party provider (Photon by
   * default) — currently only the `location` kind's own pin uses it. Absent
   * on a sidecar written before this field existed.
   */
  locationSource?: "offline" | "addressLookup";
  /**
   * What Meta's own pin carried, verbatim — the sender's phone named this
   * place (a saved contact, a business listing) before it ever left their
   * phone. Distinct from `location`/`country` above, which are this server's
   * own reverse-geocode of the coordinates: this is what the *message* said,
   * not what a lookup inferred, and absent when the pin was a bare
   * coordinate — B2013.
   */
  placeName?: string;
  placeAddress?: string;
  countryCode?: string;
  /**
   * When the *message* carrying this file was received — never a guess at
   * when the photograph was taken. Set alongside `source`, and only then: a
   * photograph sent as a photograph over WhatsApp has had its EXIF stripped,
   * so this is the one honest timestamp there is for it, and it is an arrival
   * time rather than a capture time.
   */
  receivedAt?: string;
  /**
   * Which `MEDIA_KINDS` value a v2 upload arrived as, for something that is
   * not a photograph — `files/` holds every kind side by side, so this is
   * what tells the importer a `.csv` is a bank statement rather than a GPS
   * export.
   */
  importKind?: "bank_export" | "gps_history" | "document";
  /** The importer format the caller named at upload, or absent for "let the
   * server detect it". Kept only so it survives from upload to parse. */
  importFormat?: string;
  /**
   * **Inbox transit only.** An inbox file has no gallery entry yet, so this
   * is the only address a "hold it back" answer has until it is filed. Once
   * the photograph is on a day, the gallery item carries the visibility and a
   * trip sidecar never does — `narrowedMedia` in `lib/exportZip.ts` and every
   * read path ask the item, not this file.
   */
  visibility?: PhotoVisibility;
  /** What only the pixels can say — `measureImage`, B1865. Measured once and
   * kept, so the photobook planner need not decode a second time. */
  image?: ImageFacts;
  /**
   * The **kept original's** own pixels, and how big the file was when they
   * were read — B1980.
   *
   * `image` above describes the served derivative. This describes the file
   * the photobook actually prints, which is a different photograph's worth of
   * pixels and the number the planner sizes a plate against. It was being
   * recovered by reading the whole original — two megabytes, off disk, per
   * photograph, on every preview — for two integers out of a JPEG header.
   *
   * `bytes` is the validator: an original replaced in place under the same
   * name is a thing a person can do with `scp`, and a stat is cheap where a
   * full read is not. A mismatch re-measures rather than migrating.
   *
   * Measured, never asserted — the same named exception `measuredFrom` is.
   */
  originalSize?: { width: number; height: number; bytes: number };
  /**
   * The two-axis difference hash of the served derivative — B1978.
   *
   * Computed at upload already (`perceptualHashOf`, `lib/api/media.ts`) to
   * warn about a resemblance, and until now thrown away into a deletable,
   * mtime-keyed cache under `trips/<trip>/.fingerprints/` that does not
   * exist in any of the owner's thirty trips. Kept here instead, beside
   * `image`, because that is the one file per photograph that lives as long
   * as the photograph does — and because the photobook needs it at plan
   * time, where decoding 1,500 files again would cost eight seconds it has
   * no reason to spend twice.
   *
   * Absent for every photograph uploaded before this existed;
   * `phashFor` backfills one lazily, exactly as `imageFactsFor` does. Absent
   * simply means the book does no de-duplication for that photograph, which
   * is what it did before.
   */
  phash?: string;
  /** What a model said about the picture — B1866. */
  described?: Described;
};

/**
 * Which door the bytes came through.
 *
 * `lib/api/v2/schemas/media.ts` restates this list for the response contract,
 * because a schema file may not import a runtime array from a `server-only`
 * module (see `PURCHASE_STATUSES` there for the same constraint). Keep the
 * two matching.
 */
type SidecarSource = "web" | "api" | "helper" | "whatsapp" | "import" | "sync";

/** One sidecar, or null if it is missing or malformed. A half-answer is never
 * returned: a hand-edited file that no longer parses is absent, not partial. */
export function readSidecar(file: string): Sidecar | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Sidecar;
  } catch {
    return null;
  }
}

/**
 * The only function in this repository that writes a sidecar.
 *
 * Read, merge, write beside, rename. Three properties fall out of that and
 * every one of them was a real defect before:
 *
 *  - **Unknown keys survive.** The patch is merged over what is on disk, so a
 *    writer that has never heard of `described` cannot erase it.
 *  - **A key set to `undefined` in the patch is removed**, which is how a
 *    caller retracts a fact rather than being unable to.
 *  - **Nothing ever observes a half-written file.** `renameSync` within one
 *    directory is atomic, so a reader sees the old sidecar or the new one.
 */
export function writeSidecar(file: string, patch: Partial<Sidecar>): void {
  const merged: Record<string, unknown> = { ...(readSidecar(file) ?? {}), ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`);
  fs.renameSync(temp, file);
}

/**
 * Carry a sidecar from one place to another — inbox to trip when a
 * photograph is filed, legacy to `meta/` on the first write after B1863.
 *
 * Read the old one (absent is simply an empty start), merge the patch, write
 * the destination atomically *over whatever is already there*, and only then
 * unlink the source. The order is deliberate: a crash leaves two files, never
 * none.
 */
export function moveSidecar(from: string, to: string, patch: Partial<Sidecar> = {}): void {
  writeSidecar(to, { ...(readSidecar(from) ?? {}), ...patch });
  fs.rmSync(from, { force: true });
}

/** Where a sidecar used to be written: beside the derivative, inside `media/`,
 * where the media route served it to anybody who guessed the path (B1863).
 * Still read, because an existing journal has thousands of them. */
function legacySidecarPath(ref: string, relPath: string): string {
  return path.join(tripMediaDir(ref), `${relPath}.meta.json`);
}

/**
 * `relPath` only if it stays inside the trip — null otherwise.
 *
 * A media path reaches these functions from a day's own frontmatter as well
 * as from a resolved request, and frontmatter is not something the API
 * writes: a hand-edited `src:` of `../../..` would otherwise have
 * `removeTripSidecar` unlinking a file outside the trip entirely. The same
 * containment `deleteMediaFiles` already applies to the originals directory,
 * applied here once for all three callers rather than at each of them.
 *
 * Not `safeSegment` (B1892, lib/api/v2/store.ts), which is the right guard for
 * a journal, a trip id or a day slug and is used for those: `relPath` here is
 * deliberately multi-segment — `<day>/<file>.jpg` — so what has to be proved
 * is containment of the whole path, not the safety of one segment. It also
 * answers rather than throws, because two of the three callers are deletes
 * that must stay idempotent.
 */
function containedRel(ref: string, relPath: string): string | null {
  const root = path.resolve(tripMetaDir(ref));
  const target = path.resolve(root, `${relPath}.meta.json`);
  return target.startsWith(root + path.sep) ? relPath : null;
}

/** One trip photograph's sidecar: `meta/` first, the legacy path beside the
 * derivative as a fallback. A caption that stopped answering because the file
 * moved would be a silent data loss to fix a leak. */
export function readTripSidecar(ref: string, relPath: string): Sidecar | null {
  if (!containedRel(ref, relPath)) return null;
  return readSidecar(tripSidecarPath(ref, relPath)) ?? readSidecar(legacySidecarPath(ref, relPath));
}

/**
 * Write one trip photograph's sidecar, migrating it out of `media/` on the
 * way if that is still where it lives.
 *
 * The migration is the first write to a photograph and nothing else: no
 * one-time pass, no backfill. Read the legacy file, merge, write `meta/`
 * atomically, unlink the legacy copy — so a journal converts itself as it is
 * used, and a journal nobody touches keeps working unchanged.
 */
export function writeTripSidecar(ref: string, relPath: string, patch: Partial<Sidecar>): void {
  if (!containedRel(ref, relPath)) return;
  const meta = tripSidecarPath(ref, relPath);
  const legacy = legacySidecarPath(ref, relPath);
  if (!fs.existsSync(meta) && fs.existsSync(legacy)) {
    moveSidecar(legacy, meta, patch);
    return;
  }
  writeSidecar(meta, patch);
}

/** Both places one can be, and then the day's `meta/` directory if it is now
 * empty — a delete that left a folder of nothing behind would make
 * `slugHasOrphanedMedia` refuse a slug that is genuinely free. */
export function removeTripSidecar(ref: string, relPath: string): void {
  if (!containedRel(ref, relPath)) return;
  const meta = tripSidecarPath(ref, relPath);
  fs.rmSync(meta, { force: true });
  fs.rmSync(legacySidecarPath(ref, relPath), { force: true });
  try {
    fs.rmdirSync(path.dirname(meta));
  } catch {
    // Not empty, or never there.
  }
}

/**
 * What the pixels say about one stored photograph, measured once — B1865.
 *
 * The block on the sidecar is the cache: a photograph is decoded the first
 * time somebody asks and never again, because the derivative it describes is
 * content-addressed and does not change under it. A `version` that no longer
 * matches is re-measured rather than migrated.
 *
 * `null` for anything that will not decode. A measurement is a convenience;
 * nothing that depends on it may fail for the want of it.
 */
export async function imageFactsFor(ref: string, relPath: string, file: string): Promise<ImageFacts | null> {
  const cached = readTripSidecar(ref, relPath)?.image;
  if (cached?.version === 1) return cached;
  let facts: ImageFacts;
  try {
    facts = await measureImage(file);
  } catch {
    return null;
  }
  writeTripSidecar(ref, relPath, { image: facts });
  return facts;
}

/**
 * The perceptual hash of one stored derivative, measured once — B1978.
 *
 * The same shape as `imageFactsFor` above and for the same reasons: the
 * block on the sidecar is the cache, the derivative it describes is
 * content-addressed and does not change under it, and `null` for anything
 * that will not decode, because a hash is a convenience and nothing that
 * depends on it may fail for the want of it.
 */
export async function phashFor(ref: string, relPath: string, file: string): Promise<string | null> {
  const cached = readTripSidecar(ref, relPath)?.phash;
  if (cached) return cached;
  let phash: string;
  try {
    phash = await perceptualHashOf(fs.readFileSync(file));
  } catch {
    return null;
  }
  writeTripSidecar(ref, relPath, { phash });
  return phash;
}

/**
 * The cached answer for **these exact bytes**, or null — B1866.
 *
 * Two things have to hold before a stored block is an answer. It has to parse
 * for the journal's locales as it is *now* (`parseDescribed`; a journal that
 * added Hungarian last week has no Hungarian alt text in a block written
 * before, and a half-answer is never returned), and its `contentHash` has to
 * be the hash of the derivative sitting on disk right now.
 *
 * The hash is computed rather than read off the filename on purpose: a v2
 * derivative is named after its own hash, but a v1 name is positional
 * (`01.jpg`) and says nothing about its bytes. Reading a 1080px derivative
 * and hashing it is cheap next to a model call, and it is the only thing that
 * makes a replaced-in-place photograph describe again instead of answering
 * with the description of a picture that is no longer there.
 */
export function describedFor(
  sidecar: Sidecar | null,
  file: string,
  locales: readonly string[],
): Described | null {
  const block = parseDescribed(sidecar?.described, locales);
  if (!block || block.schemaVersion !== DESCRIBED_SCHEMA_VERSION) return null;
  // A file that has gone missing under us has no cached answer — the same
  // stance every other read here takes: absent, never a half-answer.
  try {
    return block.contentHash === contentHash(fs.readFileSync(file)) ? block : null;
  } catch {
    return null;
  }
}

/**
 * What a model said, plus what makes it answerable later — to hand straight
 * to a sidecar writer as `{ described: … }`.
 *
 * A whole-key replacement, never a merge: `writeSidecar` merges at the top
 * level, so a new block overwrites the old one entire rather than leaving a
 * caption from one picture beside alt text from another.
 */
export function describedBlock(form: DescribedForm, model: string, file: string): Described {
  return {
    ...form,
    at: new Date().toISOString(),
    model,
    schemaVersion: DESCRIBED_SCHEMA_VERSION,
    contentHash: contentHash(fs.readFileSync(file)),
  };
}
