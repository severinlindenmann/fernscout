/**
 * Reading a ZIP's own index and individual entries, from a `Blob`/`File`,
 * without ever holding the whole archive in memory — B2662. A Polarsteps
 * `user_data.zip` is routinely several gigabytes; this is why the studio
 * screen reads it in the browser with `File.slice` rather than uploading it
 * whole to be unzipped server-side.
 *
 * Framework-free on purpose (lib/exportZip.ts's own comment on `archiver`
 * is about a Node stream and does not help here): a marketing page and the
 * studio both import this with no bundle cost beyond what is here.
 *
 * Reads the central directory, never a streaming scan of local headers —
 * every real zip writer puts one at the end, and it is the only index that
 * is trustworthy without reading the entries themselves (a local header can
 * lie about size; the tools that build zip bombs rely on exactly that).
 *
 * ponytail: ZIP64 is read when the *entries* use it (compressed/uncompressed
 * size or local-header offset past 4 GiB) and when the *end record* uses it
 * (more than 65 535 entries, or the central directory itself past 4 GiB) —
 * the two places a multi-gigabyte real export can actually hit the 32-bit
 * ceiling. A spanned/split archive (multiple `.z01` volumes) is refused
 * outright rather than read; nobody exports Polarsteps that way.
 */

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EXTRA_ID = 0x0001;

/** The end-of-central-directory record is at most this far from the end of
 * the file: 22 fixed bytes plus a comment of at most 65 535. */
const MAX_EOCD_SCAN = 22 + 0xffff;

export type ZipEntry = {
  /** Always forward-slashed, always relative — `../` and absolute paths are
   * dropped before this list is ever returned (see `isSafeName` below). */
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  /** `0` (stored) or `8` (deflate) — anything else is refused when the
   * entry is actually read, not here, so a caller can still list a zip that
   * carries one odd entry it will never ask to read. */
  compressionMethod: number;
  localHeaderOffset: number;
};

export class ZipError extends Error {}

function isSafeName(name: string): boolean {
  if (!name || name.endsWith("/")) return false; // a directory entry, not a file
  if (name.startsWith("/") || name.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(name)) return false; // a Windows drive-rooted path
  return !name.split(/[\\/]/).some((part) => part === "..");
}

async function readBytes(file: Blob, start: number, end: number): Promise<DataView> {
  const buf = await file.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

function utf8(buf: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("utf-8").decode(buf as ArrayBuffer);
}

/** The 64-bit fields a central-directory entry's zip64 extra field carries,
 * in the fixed order the spec gives them — but only the ones whose 32-bit
 * field was actually the `0xFFFFFFFF` sentinel; a writer omits the rest. */
function readZip64Extra(
  extra: DataView,
  need: { uncompressedSize: boolean; compressedSize: boolean; localHeaderOffset: boolean },
): { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } {
  let offset = 0;
  while (offset + 4 <= extra.byteLength) {
    const id = extra.getUint16(offset, true);
    const size = extra.getUint16(offset + 2, true);
    if (id === ZIP64_EXTRA_ID) {
      const view = new DataView(extra.buffer, extra.byteOffset + offset + 4, size);
      let p = 0;
      const out: { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } = {};
      if (need.uncompressedSize && p + 8 <= size) {
        out.uncompressedSize = Number(view.getBigUint64(p, true));
        p += 8;
      }
      if (need.compressedSize && p + 8 <= size) {
        out.compressedSize = Number(view.getBigUint64(p, true));
        p += 8;
      }
      if (need.localHeaderOffset && p + 8 <= size) {
        out.localHeaderOffset = Number(view.getBigUint64(p, true));
      }
      return out;
    }
    offset += 4 + size;
  }
  return {};
}

/** Find the end-of-central-directory record, scanning backward for its
 * signature — a zip's comment (and some writers' own padding) means it is
 * not reliably at a fixed offset from the end. */
async function findEocd(file: Blob): Promise<{ cdOffset: number; cdSize: number; entryCount: number }> {
  const tailStart = Math.max(0, file.size - MAX_EOCD_SCAN);
  const tail = await readBytes(file, tailStart, file.size);
  let eocdAt = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocdAt = i;
      break;
    }
  }
  if (eocdAt < 0) throw new ZipError("Not a ZIP file — no end-of-central-directory record found.");

  let totalEntries = tail.getUint16(eocdAt + 10, true);
  let cdSize = tail.getUint32(eocdAt + 12, true);
  let cdOffset = tail.getUint32(eocdAt + 16, true);

  const needsZip64 = totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  if (needsZip64) {
    // The locator is a fixed 20 bytes immediately before the EOCD record.
    const locatorAt = tailStart + eocdAt - 20;
    if (locatorAt < 0) throw new ZipError("ZIP64 end-of-central-directory locator not found.");
    const locator = await readBytes(file, locatorAt, locatorAt + 20);
    if (locator.getUint32(0, true) !== EOCD64_LOCATOR_SIG) {
      throw new ZipError("This ZIP declares more entries or a larger central directory than a 32-bit field can hold, but its ZIP64 locator is missing or malformed.");
    }
    const eocd64Offset = Number(locator.getBigUint64(8, true));
    const record = await readBytes(file, eocd64Offset, eocd64Offset + 56);
    if (record.getUint32(0, true) !== EOCD64_SIG) {
      throw new ZipError("ZIP64 end-of-central-directory record not found at the offset its locator named.");
    }
    totalEntries = Number(record.getBigUint64(32, true));
    cdSize = Number(record.getBigUint64(40, true));
    cdOffset = Number(record.getBigUint64(48, true));
  }

  return { cdOffset, cdSize, entryCount: totalEntries };
}

/**
 * The index: every file entry's name and sizes, read from the central
 * directory alone — no entry's bytes are touched. Entries naming `..`, an
 * absolute path, or a directory are silently dropped; a caller never sees
 * one it could use to escape the folder it asked to read.
 */
export async function readZipEntries(file: Blob): Promise<ZipEntry[]> {
  const { cdOffset, cdSize, entryCount } = await findEocd(file);
  if (cdOffset + cdSize > file.size) {
    throw new ZipError("The central directory's own offset and size run past the end of the file — this is not a complete ZIP.");
  }
  const cd = await readBytes(file, cdOffset, cdOffset + cdSize);

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < entryCount && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== CENTRAL_SIG) {
      throw new ZipError("The central directory is malformed — an entry did not start where the one before it said it would.");
    }
    const compressionMethod = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let uncompressedSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localHeaderOffset = cd.getUint32(p + 42, true);

    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    const name = utf8(nameBytes).replace(/\\/g, "/");

    const needsZip64 =
      compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff;
    if (needsZip64) {
      const extra = new DataView(cd.buffer, cd.byteOffset + p + 46 + nameLen, extraLen);
      const z64 = readZip64Extra(extra, {
        uncompressedSize: uncompressedSize === 0xffffffff,
        compressedSize: compressedSize === 0xffffffff,
        localHeaderOffset: localHeaderOffset === 0xffffffff,
      });
      if (uncompressedSize === 0xffffffff) uncompressedSize = z64.uncompressedSize ?? uncompressedSize;
      if (compressedSize === 0xffffffff) compressedSize = z64.compressedSize ?? compressedSize;
      if (localHeaderOffset === 0xffffffff) localHeaderOffset = z64.localHeaderOffset ?? localHeaderOffset;
      if (
        uncompressedSize === 0xffffffff ||
        compressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      ) {
        throw new ZipError(`"${name}" needs its ZIP64 extra field to read a real size, and it is missing one.`);
      }
    }

    if (isSafeName(name)) {
      entries.push({ name, compressedSize, uncompressedSize, compressionMethod, localHeaderOffset });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * One entry's bytes, decompressed. `maxBytes` refuses before a single byte
 * is inflated when the entry's own *declared* uncompressed size already
 * exceeds it — the zip-bomb guard: a crafted 1000:1 entry is caught on its
 * central-directory record, never by inflating 30 MB to find out. The
 * result is checked against that same declared size afterward too, so a
 * local header that under-declares and then streams more cannot slip past.
 */
export async function readZipEntryBytes(file: Blob, entry: ZipEntry, opts: { maxBytes?: number } = {}): Promise<Uint8Array> {
  if (opts.maxBytes !== undefined && entry.uncompressedSize > opts.maxBytes) {
    throw new ZipError(
      `"${entry.name}" is ${entry.uncompressedSize} bytes uncompressed, over the ${opts.maxBytes} byte limit for this kind of entry.`,
    );
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new ZipError(`"${entry.name}" uses compression method ${entry.compressionMethod}, which this reader does not know.`);
  }

  const header = await readBytes(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (header.getUint32(0, true) !== LOCAL_SIG) {
    throw new ZipError(`"${entry.name}"'s local file header is not where the central directory said it would be.`);
  }
  const nameLen = header.getUint16(26, true);
  const extraLen = header.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;

  let bytes: Uint8Array;
  if (entry.compressionMethod === 0) {
    bytes = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
  } else {
    const stream = file.slice(dataStart, dataEnd).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buf = await new Response(stream).arrayBuffer();
    bytes = new Uint8Array(buf);
  }

  if (bytes.byteLength !== entry.uncompressedSize) {
    throw new ZipError(
      `"${entry.name}" decompressed to ${bytes.byteLength} bytes, not the ${entry.uncompressedSize} the central directory declared.`,
    );
  }
  return bytes;
}

/** `readZipEntryBytes`, decoded as UTF-8 text — what every caller here
 * actually wants (`trip.json`, `locations.json`). */
export async function readZipEntryText(file: Blob, entry: ZipEntry, opts: { maxBytes?: number } = {}): Promise<string> {
  return utf8(await readZipEntryBytes(file, entry, opts));
}
