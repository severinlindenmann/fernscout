"use client";

import { MEDIA_WIDTHS } from "@/lib/mediaSizes";

/**
 * Forty photographs from a phone on hotel wifi — B683.
 *
 * The failure this exists for is the least recoverable one in the product: a
 * browser pushing 50 MB HEICs one after another over a connection that drops,
 * with nothing written down, so a killed tab loses the lot and re-picking the
 * same folder makes a second copy of everything that did land.
 *
 * Three ideas, and none of them is a protocol:
 *
 * 1. **Two phases.** A 2000px copy — the widest size `MEDIA_WIDTHS` serves —
 *    goes up first, so the day is readable within seconds of the first few
 *    landing. The untouched original follows against the item that copy
 *    created, and it may still be climbing while the person writes their
 *    words. Both are kept; `originals/` is what the photobook prints from.
 * 2. **The queue is on disk, not in a React state.** IndexedDB holds the
 *    `File` objects themselves, so closing the tab on the bus and opening it
 *    again in the hotel resumes exactly where it stopped. This is the only
 *    client-side state in the feature — everything else about a day is
 *    answered by the draft on the server, which is the plan's §1.
 * 3. **The key is the bytes.** A re-picked photograph resolves to the row that
 *    is already there rather than to a second one, so "select all" twice
 *    uploads once. The server has its own perceptual check on top of this
 *    (`storeUploads`, B604); this one is what stops the *queue* doubling.
 *
 * Deliberately not a chunked byte-range protocol. One request per file, in
 * order, with backoff, is enough for a photograph; add ranges the day a 4K
 * clip proves otherwise.
 */

const DB_NAME = "fernscout-uploads";
const DB_VERSION = 1;
const STORE = "queue";

/** The width the pipeline already targets, so the web copy is what the server
 *  would have made anyway and no second size enters the system. */
const WEB_EDGE = MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1];

/** How much of a file the key reads from each end.
 *
 *  Not the whole file: `crypto.subtle.digest` has no streaming form, so a true
 *  SHA-256 of forty 50 MB photographs means reading two gigabytes into a
 *  phone's memory to answer a question about identity. Size plus a megabyte
 *  from each end is the same trade `sampledFileHash` in lib/ingest/hash.ts
 *  already makes for video, for the same reason, and two different
 *  photographs agreeing on all three does not happen. */
const SAMPLE_BYTES = 1024 * 1024;

/** Waiting between attempts, doubling, capped. A hotel connection comes back
 *  in seconds or in minutes and there is no way to tell which from here. */
const RETRY_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export type QueueItem = {
  /** `<user>/<trip>/<slug>/<hash>` — the row a re-picked file lands on. */
  key: string;
  user: string;
  trip: string;
  slug: string;
  filename: string;
  size: number;
  file: File;
  /** The `src` the web copy's upload came back with; null until it lands. */
  src: string | null;
  webDone: boolean;
  /** True the moment there is nothing more to send — including for a file that
   *  went up whole because the browser could not downscale it. */
  originalDone: boolean;
  /** A refusal the server will give again for the same bytes. Retrying it
   *  forever is how a queue stops making progress on everything behind it. */
  failed: string | null;
};

export type QueueProgress = {
  webDone: number;
  webTotal: number;
  originalDone: number;
  originalTotal: number;
  /** Something worth putting on the screen: a refused file, or a connection
   *  that has not come back. Never fatal — the rows stay on disk. */
  error: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function all(user: string): Promise<QueueItem[]> {
  const db = await openDb();
  try {
    const rows = await wrap<QueueItem[]>(db.transaction(STORE).objectStore(STORE).getAll());
    return rows.filter((row) => row.user === user);
  } finally {
    db.close();
  }
}

async function put(item: QueueItem): Promise<void> {
  const db = await openDb();
  try {
    await wrap(db.transaction(STORE, "readwrite").objectStore(STORE).put(item));
  } finally {
    db.close();
  }
}

async function drop(key: string): Promise<void> {
  const db = await openDb();
  try {
    await wrap(db.transaction(STORE, "readwrite").objectStore(STORE).delete(key));
  } finally {
    db.close();
  }
}

/** Identity for a file, from its own bytes. See `SAMPLE_BYTES`. */
async function fileKey(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  const tail =
    file.size > SAMPLE_BYTES
      ? new Uint8Array(await file.slice(Math.max(SAMPLE_BYTES, file.size - SAMPLE_BYTES)).arrayBuffer())
      : new Uint8Array(0);
  const label = new TextEncoder().encode(`${file.size}:`);
  const joined = new Uint8Array(label.length + head.length + tail.length);
  joined.set(label, 0);
  joined.set(head, label.length);
  joined.set(tail, label.length + head.length);
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * The 2000px copy, or null when this browser cannot make one.
 *
 * Null is not a failure: it is a screenshot already smaller than the target, a
 * video, or a HEIC on a browser that will not decode one. The caller sends the
 * file whole in that case, which is exactly what B682 did — the two-phase path
 * is an optimisation, and falling out of it has to leave a working upload
 * rather than a refused photograph.
 */
async function webCopy(file: File): Promise<File | null> {
  if (typeof createImageBitmap !== "function") return null;
  if (!/\.(jpe?g|png|heic|heif|webp|avif|tiff?)$/i.test(file.name)) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= WEB_EDGE) return null; // Already web-sized: one phase is right.
    const scale = WEB_EDGE / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob) return null;
    // The stem is kept so the day reads back the name the person recognises;
    // the extension has to be the truth about the bytes, because the server
    // decides format from it.
    const stem = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

/**
 * Add files to the queue for one day. Already-queued bytes are left alone.
 *
 * Returns the rows, so the caller can count what it is about to send without
 * a second read.
 */
export async function enqueue(
  user: string,
  trip: string,
  slug: string,
  files: File[],
): Promise<QueueItem[]> {
  const existing = new Map((await all(user)).map((row) => [row.key, row]));
  const out: QueueItem[] = [];
  for (const file of files) {
    const key = `${user}/${trip}/${slug}/${await fileKey(file)}`;
    const already = existing.get(key);
    if (already) {
      out.push(already);
      continue;
    }
    const item: QueueItem = {
      key,
      user,
      trip,
      slug,
      filename: file.name,
      size: file.size,
      file,
      src: null,
      webDone: false,
      originalDone: false,
      failed: null,
    };
    await put(item);
    existing.set(key, item);
    out.push(item);
  }
  return out;
}

/** Everything still owed for this journal, whichever day it belongs to. */
export async function outstanding(user: string): Promise<QueueItem[]> {
  return (await all(user)).filter((row) => row.failed === null && !(row.webDone && row.originalDone));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Sent = { ok: true; body: Record<string, unknown> } | { ok: false; retry: boolean; error: string };

async function post(user: string, form: FormData): Promise<Sent> {
  let response: Response;
  try {
    response = await fetch(`/api/helper/${encodeURIComponent(user)}/day/media`, {
      method: "POST",
      body: form,
    });
  } catch {
    return { ok: false, retry: true, error: "network" };
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { ok: true, body };
  const problems = Array.isArray(body.problems)
    ? (body.problems as { expected?: string }[]).map((p) => p.expected ?? "").filter(Boolean).join("; ")
    : "";
  // A 4xx is the server saying the same thing about the same bytes forever.
  // Only a 5xx or a dead connection is worth waiting out.
  return {
    ok: false,
    retry: response.status >= 500,
    error: problems || String(body.error ?? response.status),
  };
}

/** One request, retried with backoff until it lands or is plainly refused. */
async function sendWithBackoff(user: string, form: () => FormData): Promise<Sent> {
  let last: Sent = { ok: false, retry: true, error: "network" };
  for (const wait of [0, ...RETRY_MS]) {
    if (wait > 0) await sleep(wait);
    last = await post(user, form());
    if (last.ok || !last.retry) return last;
  }
  return last;
}

let draining = false;

/**
 * Send everything owed, web copies first and originals afterwards.
 *
 * The order is the whole point: every day in the queue becomes readable before
 * any original starts climbing, so a person who picked forty photographs sees
 * a complete day in the time the first phase takes and can walk on to writing
 * the words while the rest goes up behind them.
 *
 * Sequential on purpose. Six parallel uploads on a connection this bad is six
 * things timing out instead of one thing finishing.
 */
export async function drain(
  user: string,
  onProgress: (progress: QueueProgress) => void,
): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    let rows = await outstanding(user);
    let error: string | null = null;
    const report = () => {
      onProgress({
        webDone: rows.filter((r) => r.webDone).length,
        webTotal: rows.length,
        originalDone: rows.filter((r) => r.originalDone).length,
        originalTotal: rows.length,
        error,
      });
    };
    report();

    for (const row of rows) {
      if (row.webDone) continue;
      const copy = await webCopy(row.file);
      const sent = await sendWithBackoff(user, () => {
        const form = new FormData();
        form.set("trip", row.trip);
        form.set("day", row.slug);
        form.set("phase", "web");
        form.set("file", copy ?? row.file, (copy ?? row.file).name);
        return form;
      });
      if (!sent.ok) {
        error = sent.error;
        if (!sent.retry) {
          row.failed = sent.error;
          await put(row);
          report();
          continue;
        }
        report();
        return; // The connection is gone. The rows stay; the next drain resumes.
      }
      row.webDone = true;
      row.src = (sent.body.src as string | null) ?? null;
      // Nothing more to send when the whole file already went, when the server
      // recognised the photograph as one the day already has, or when there is
      // no item to hang an original on.
      row.originalDone = copy === null || row.src === null || sent.body.duplicate === true;
      await put(row);
      report();
    }

    rows = rows.filter((row) => row.failed === null);
    for (const row of rows) {
      if (row.originalDone || !row.src) continue;
      const sent = await sendWithBackoff(user, () => {
        const form = new FormData();
        form.set("trip", row.trip);
        form.set("phase", "original");
        form.set("src", row.src as string);
        form.set("file", row.file, row.filename);
        return form;
      });
      if (!sent.ok) {
        error = sent.error;
        if (!sent.retry) {
          row.failed = sent.error;
          await put(row);
          report();
          continue;
        }
        report();
        return;
      }
      row.originalDone = true;
      await put(row);
      report();
    }

    // Done rows are dropped rather than kept as a history: the day on the
    // server is the record, and a browser holding forty 50 MB files it has
    // already sent is a phone that runs out of room.
    for (const row of rows) {
      if (row.webDone && row.originalDone) await drop(row.key);
    }
    report();
  } finally {
    draining = false;
  }
}
