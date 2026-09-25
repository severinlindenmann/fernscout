/**
 * The offline outbox — B2329, wave 1 of B2210.
 *
 * A studio write today is one live `fetch`: no signal, and the change the
 * owner just made is gone with no trace. This is the queue that survives
 * that — an ordered list of not-yet-sent writes, kept in IndexedDB so it
 * outlives a reload, replayed one at a time once there is a connection.
 *
 * Nothing here is wired to an actual flow yet (that is B2330); this wave
 * only has to prove the queue and the replay decision work. The module is
 * split in two on purpose:
 *
 *   - The **pure core** (`decideReplay`) — what a response means for one
 *     intent. No IndexedDB, no `fetch`, so it is exercised directly in a
 *     unit test with a fabricated response, and it is the only part
 *     `runOutbox` asks to make a call.
 *   - The **glue** (`openOutboxStore`, `runOutbox`) — the actual IndexedDB
 *     reads and writes, and the network. `runOutbox` takes its `fetch` and
 *     its `OutboxStore` as arguments precisely so a test can hand it an
 *     in-memory store and a scripted `fetch` instead of a browser.
 */

/** B2331 — `"transcribed"` is a `voice.note`'s own resting state once the
 *  transcribe route has answered: not removed (D4 — never inserted
 *  silently) and not `"conflict"` (nobody refused it), so it needed a state
 *  of its own rather than overloading either. */
type IntentState = "pending" | "conflict" | "transcribed";

/** One not-yet-confirmed studio write. `id` is chosen on the phone (not the
 *  server) so the same intent survives being retried without becoming two. */
export interface OutboxIntent {
  id: string;
  /** The studio username this write belongs to — the outbox's own scope,
   *  the same boundary `purgePersonal` draws around the worker's cache. */
  user: string;
  /** Which route family this is, for the small amount of response-shape
   *  knowledge `decideReplay` needs (see `sameAsSent`). Free-form on
   *  purpose — a route that never needs it can pick anything. */
  kind: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  body: unknown;
  createdAt: string;
  state: IntentState;
  /** Only for `kind: "media.upload"` (B2330) — the original file, kept as
   *  IndexedDB's own `Blob` support rather than base64 in `body`, so a queued
   *  photograph is still its own print master and never re-encoded. */
  blob?: Blob;
  /** B2330 wave 2 — extra headers a replay must send beyond the plain
   *  `content-type: application/json` every non-upload intent already gets.
   *  So far only `if-match`: "Change a day" reads a version when it opens
   *  (`EditDay.tsx`) and a queued edit must replay against the same one, so
   *  a save built on a stale read is refused (409, a `conflict`) rather than
   *  silently applied over whatever moved underneath while this was queued. */
  headers?: Record<string, string>;
  /** B2331 — the last thing the server told this intent when it could not
   *  simply be applied. For a `day.edit` left `"conflict"`, the 409's own
   *  body (`{ error, details: <the day as the server holds it now> }`); for
   *  a `voice.note` left `"transcribed"`, the transcript text itself.
   *  Unknown shape here on purpose — read only by the screen for the one
   *  kind that produced it (`pendingConflicts`, `pendingVoiceTranscripts`). */
  details?: unknown;
}

export type NewIntent = Omit<OutboxIntent, "id" | "createdAt" | "state">;

type ReplayAction = "done" | "conflict" | "pause" | "retry";

export interface ReplayOutcome {
  action: ReplayAction;
}

/**
 * `existing` (the day-create route's own 409 body, `lib/studio/createDay.ts`
 * via `app/api/helper/[user]/day/new/route.ts:58`) really is the same day
 * this intent tried to create, rather than a different one somebody else
 * put on the same date in the meantime.
 *
 * Deliberately narrow: this wave wires no flow to the outbox, so the only
 * 409 shape worth knowing is the one route the ticket names. A route added
 * later that wants the same treatment adds its own case here rather than
 * this function guessing at a shape it has never seen.
 *
 * ponytail: field-by-field comparison of what the owner actually typed
 * (title/time/location), not a hash of the whole body — good enough while
 * one route uses this; widen it if a second route's "same" needs more.
 */
function sameAsSent(intent: OutboxIntent, responseBody: unknown): boolean {
  if (intent.kind !== "day.new") return false;
  if (!responseBody || typeof responseBody !== "object") return false;
  const existing = (responseBody as { existing?: unknown }).existing;
  if (!existing || typeof existing !== "object") return false;
  const sent = intent.body;
  if (!sent || typeof sent !== "object") return false;
  const e = existing as Record<string, unknown>;
  const s = sent as Record<string, unknown>;
  const fields = ["date", "title", "time", "location"] as const;
  return fields.every((f) => s[f] === undefined || s[f] === e[f]);
}

/**
 * What one intent's response means for the queue. Pure — no IndexedDB, no
 * network, so it is the whole of what a unit test needs to drive.
 *
 *   2xx                          → done, remove it
 *   409, and it is the day we
 *   already meant to create      → done, remove it (a retried success)
 *   409, anything else           → conflict — kept, counted, shown later
 *   401 / 403                    → pause — stop the whole queue, drop nothing
 *   network error / 5xx          → retry — stop this pass, try again later
 *   any other 4xx                → conflict — not retryable, not silently lost
 */
export function decideReplay(
  status: number,
  responseBody: unknown,
  intent: OutboxIntent,
): ReplayOutcome {
  if (status >= 200 && status < 300) return { action: "done" };
  if (status === 401 || status === 403) return { action: "pause" };
  if (status === 409) return { action: sameAsSent(intent, responseBody) ? "done" : "conflict" };
  if (status === 0 || status >= 500) return { action: "retry" };
  return { action: "conflict" };
}

/** What `runOutbox` reports back — enough for the studio bar's pill and for
 *  a test's assertions, never more. */
export interface RunOutcome {
  done: number;
  conflicts: number;
  paused: boolean;
  /** True when a network error or 5xx stopped the pass with intents still
   *  in `pending` state waiting for the next run. */
  stoppedForRetry: boolean;
  /** B2331 — how many `voice.note` intents this pass turned into a
   *  transcript waiting for the owner's own confirmation. Optional and
   *  absent whenever it would be zero, so every existing assertion on this
   *  shape (`toEqual`, no such key) is unaffected. */
  transcribed?: number;
}

/** The IndexedDB glue's own shape, so `runOutbox` (and its tests) never talk
 *  to `indexedDB` directly. */
export interface OutboxStore {
  list(user: string): Promise<OutboxIntent[]>;
  add(intent: OutboxIntent): Promise<void>;
  remove(id: string): Promise<void>;
  /** B2331 — `details` is optional and additive: every existing caller
   *  (`"conflict"`, no third argument) is unchanged. Carries the 409 body
   *  for a `day.edit` conflict, or the transcript text for a `voice.note`
   *  moved to `"transcribed"` — see `OutboxIntent.details`. */
  setState(id: string, state: IntentState, details?: unknown): Promise<void>;
  /** Drops every intent for one owner — signing out, the same boundary
   *  `purgePersonal` clears the worker's cache at. */
  clear(user: string): Promise<void>;
  /** B2330 — a `media.upload` intent has just resolved to a real inbox id;
   *  rewrite `mediaInboxIds` on every other pending intent for this owner
   *  that still names the placeholder, in place, so a later replay sends
   *  the id the server actually knows. */
  remapMediaId(user: string, placeholderId: string, realId: string): Promise<void>;
}

/** `body.mediaInboxIds` with one id swapped, or the same array reference
 *  when the placeholder is not in it — pure, so `remapMediaId`'s own
 *  IndexedDB glue is the only part that has to be exercised through a real
 *  store. */
function withRemappedMedia(body: unknown, placeholderId: string, realId: string): unknown {
  if (!body || typeof body !== "object") return body;
  const ids = (body as { mediaInboxIds?: unknown }).mediaInboxIds;
  if (!Array.isArray(ids) || !ids.includes(placeholderId)) return body;
  return { ...body, mediaInboxIds: ids.map((id) => (id === placeholderId ? realId : id)) };
}

/** B2331 — a queued `voice.note`'s own `Blob`, base64-encoded for the
 *  transcribe route's JSON body. `RecordButton`'s own live `send()` does the
 *  same encoding with `FileReader`, which has no equivalent outside a
 *  window; `Blob.arrayBuffer()` plus `btoa` runs the same wherever
 *  `runOutbox` does (a browser tab, and a plain Node `Blob` in this file's
 *  own unit tests). */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // ponytail: chunked to stay under `String.fromCharCode`'s own argument
  // ceiling on a long recording; a streaming base64 encoder if a voice note
  // ever needs to be longer than fits comfortably in memory once at all.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Replay one owner's queue, in order, one intent at a time.
 *
 * Stops the pass (but not the queue — nothing already `pending` is
 * touched) the moment a retry or a pause is called for, so a later intent
 * never jumps ahead of one still waiting for the network, and a paused
 * queue never has an intent removed behind the owner's back.
 */
export async function runOutbox(
  store: OutboxStore,
  user: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunOutcome> {
  const outcome: RunOutcome = { done: 0, conflicts: 0, paused: false, stoppedForRetry: false };
  const intents = (await store.list(user)).filter((i) => i.state === "pending");
  for (const [i, intent] of intents.entries()) {
    let status: number;
    let body: unknown = null;
    try {
      // `media.upload` (B2330) carries the original file as a `Blob`, kept
      // as `intent.blob` rather than in `intent.body` (JSON only) — sent as
      // the same multipart the inbox route already accepts from a live
      // upload, so the queued photograph is never re-encoded on its way in.
      const isUpload = intent.kind === "media.upload" && intent.blob;
      // B2331 — a voice note (`SpeakFlow`'s own recording, queued while the
      // server could not be reached) also carries its audio as `intent.blob`
      // rather than in `body`, but the transcribe route
      // (`app/api/helper/[user]/transcribe/route.ts`) takes JSON with the
      // audio as base64, never multipart the way the inbox route does — so
      // this folds it into the plain JSON body instead of sending its own
      // form, the one difference from `media.upload`'s own branch below.
      const isVoiceNote = intent.kind === "voice.note" && intent.blob;
      let requestBody: BodyInit | undefined;
      let headers: Record<string, string> | undefined;
      if (isUpload) {
        const form = new FormData();
        const filename = (intent.body as { filename?: string } | null)?.filename ?? "photo";
        form.append("files", intent.blob as Blob, filename);
        requestBody = form;
      } else if (isVoiceNote) {
        headers = { "content-type": "application/json", ...intent.headers };
        const audio = await blobToBase64(intent.blob as Blob);
        requestBody = JSON.stringify({ ...(intent.body as Record<string, unknown> | null), audio });
      } else {
        headers = { "content-type": "application/json", ...intent.headers };
        requestBody = intent.method === "DELETE" && intent.body === undefined ? undefined : JSON.stringify(intent.body);
      }
      const res = await fetchImpl(intent.url, { method: intent.method, headers, body: requestBody });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      outcome.stoppedForRetry = true;
      break;
    }

    const { action } = decideReplay(status, body, intent);
    if (action === "done") {
      // B2331, D4 — a transcribed voice note is not simply dropped like
      // every other successful replay: the owner has to see and confirm it
      // before it becomes part of the day's words, so it is kept
      // (`"transcribed"`, the response's own text attached) rather than
      // removed. A recording that came back with nothing to say (silence,
      // an empty answer) has nothing for the owner to confirm either way.
      if (intent.kind === "voice.note") {
        const said = String((body as { text?: unknown } | null)?.text ?? "").trim();
        if (said) {
          await store.setState(intent.id, "transcribed", said);
          outcome.transcribed = (outcome.transcribed ?? 0) + 1;
        } else {
          await store.remove(intent.id);
        }
        outcome.done += 1;
        continue;
      }
      await store.remove(intent.id);
      outcome.done += 1;
      // The inbox route hands back the real id it stored the file under;
      // any not-yet-sent intent that referenced this upload's phone-chosen
      // placeholder (a day written offline, alongside its photographs) is
      // rewritten in place so it sends the real id, not one the server has
      // never heard of.
      if (intent.kind === "media.upload") {
        const placeholderId = (intent.body as { placeholderId?: string } | null)?.placeholderId;
        const items = (body as { items?: { id?: string }[] } | null)?.items;
        const realId = items?.[0]?.id;
        if (placeholderId && realId) {
          await store.remapMediaId(user, placeholderId, realId);
          // `store.remapMediaId` only rewrites IndexedDB — `intents` above is
          // a snapshot taken before this pass started, so a day queued after
          // its own photographs (the ordering this whole thing exists for)
          // would otherwise still hold the placeholder when its own turn
          // comes later in this same pass, fail with a media the server has
          // never heard of, and be marked a permanent "conflict" for an id
          // that in fact resolved a moment earlier. Rewrite the copies still
          // waiting their turn too.
          for (let j = i + 1; j < intents.length; j++) {
            intents[j].body = withRemappedMedia(intents[j].body, placeholderId, realId);
          }
        }
      }
    } else if (action === "conflict") {
      // B2331, D3 — the response body (for `day.edit`, the 409's own
      // `{ error, details: <the day as the server holds it now> }`) is kept
      // on the intent, not just the bare state, so the owner's own two-
      // versions screen (`pendingConflicts`) can show what the server holds
      // without a second read.
      await store.setState(intent.id, "conflict", body);
      outcome.conflicts += 1;
    } else if (action === "pause") {
      outcome.paused = true;
      break;
    } else {
      outcome.stoppedForRetry = true;
      break;
    }
  }
  return outcome;
}

const DB_NAME = "fernscout-outbox";
const STORE_NAME = "intents";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("user", "user", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * The real, IndexedDB-backed `OutboxStore`. `indexedDB` is absent in a
 * server render and in the plain Node test environment this repository
 * runs Vitest under — callers that might run there use `hasOutbox()` first.
 */
export function openOutboxStore(): OutboxStore {
  return {
    async list(user) {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("user");
      const rows = await promisify(index.getAll(IDBKeyRange.only(user)));
      db.close();
      return (rows as OutboxIntent[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async add(intent) {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(intent);
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    },
    async remove(id) {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    },
    async setState(id, state, details) {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const existing = await promisify(store.get(id));
      if (existing) {
        store.put({ ...(existing as OutboxIntent), state, ...(details !== undefined ? { details } : {}) });
      }
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    },
    async clear(user) {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const index = tx.objectStore(STORE_NAME).index("user");
      const keys = await promisify(index.getAllKeys(IDBKeyRange.only(user)));
      const store = tx.objectStore(STORE_NAME);
      for (const key of keys) store.delete(key);
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    },
    async remapMediaId(user, placeholderId, realId) {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const index = tx.objectStore(STORE_NAME).index("user");
      const rows = (await promisify(index.getAll(IDBKeyRange.only(user)))) as OutboxIntent[];
      const store = tx.objectStore(STORE_NAME);
      for (const row of rows) {
        const rewritten = withRemappedMedia(row.body, placeholderId, realId);
        if (rewritten !== row.body) store.put({ ...row, body: rewritten });
      }
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    },
  };
}

/** Whether this runtime can hold an outbox at all — no IndexedDB (an old
 *  browser, a server render, a plain Node test) means the capability is
 *  simply absent, not broken. */
export function hasOutbox(): boolean {
  return typeof indexedDB !== "undefined";
}

/** A fresh intent, phone-chosen id and timestamp included — the shape
 *  `OutboxStore.add` expects. */
export function newIntent(input: NewIntent): OutboxIntent {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    state: "pending",
  };
}

/** ISO dates with a `day.new` write still waiting in the queue — B2330's
 *  "waiting" marker on the day picker, read straight off the outbox rather
 *  than kept as its own piece of state anywhere. */
export async function pendingDayDates(store: OutboxStore, user: string): Promise<Set<string>> {
  const rows = await store.list(user);
  const dates = rows
    .filter((r) => r.state === "pending" && r.kind === "day.new")
    .map((r) => (r.body as { date?: unknown } | null)?.date)
    .filter((d): d is string => typeof d === "string");
  return new Set(dates);
}

/** B2331, D4 — one `voice.note` that has come back transcribed but has not
 *  yet been shown to the owner: `date` is the day it was recorded for
 *  (`SpeakFlow`'s own queueing), `text` is exactly what the transcribe route
 *  answered. */
export interface PendingTranscript {
  id: string;
  date: string;
  text: string;
}

/** Every voice note waiting on the owner's own "check it" — never inserted
 *  into a day on its own (D4). Read by `EditDay.tsx` and filtered to
 *  whichever day is open. */
export async function pendingVoiceTranscripts(store: OutboxStore, user: string): Promise<PendingTranscript[]> {
  const rows = await store.list(user);
  return rows
    .filter((r) => r.kind === "voice.note" && r.state === "transcribed")
    .map((r) => ({
      id: r.id,
      date: String((r.body as { date?: unknown } | null)?.date ?? ""),
      text: String(r.details ?? ""),
    }))
    .filter((r) => r.date !== "" && r.text !== "");
}

/** B2331, D3 — a `day.edit` queued while offline whose replay came back 409
 *  `stale_document`: two versions now exist and neither is applied until the
 *  owner picks. `serverDoc` is the day exactly as `applyDayPatch` answered
 *  it (the 409's own `details`, a full `dayDoc`); `phonePatch` is exactly
 *  what this intent would have sent. */
export interface DayEditConflict {
  id: string;
  url: string;
  createdAt: string;
  headers?: Record<string, string>;
  phonePatch: Record<string, unknown>;
  serverDoc: Record<string, unknown> | null;
}

/** Every `day.edit` left as a conflict for one owner, across every day —
 *  read by the pill's own "N needs a decision" and by `EditDay.tsx`, scoped
 *  there to whichever day is open. */
export async function pendingConflicts(store: OutboxStore, user: string): Promise<DayEditConflict[]> {
  const rows = await store.list(user);
  return rows
    .filter((r) => r.kind === "day.edit" && r.state === "conflict")
    .map((r) => ({
      id: r.id,
      url: r.url,
      createdAt: r.createdAt,
      headers: r.headers,
      phonePatch: (r.body ?? {}) as Record<string, unknown>,
      serverDoc: ((r.details as { details?: unknown } | null)?.details ?? null) as Record<string, unknown> | null,
    }));
}

/**
 * D3 — "Keep this phone's words": re-read the day's current version and
 * resend this intent's own patch against it, so the resend is measured
 * against what the server holds *now* rather than the stale read this queue
 * started from. The owner's own tap is what turns "would conflict" into
 * "replace it anyway" — `runOutbox` itself never does this on its own.
 *
 * Removed only once the server actually accepts it; a failure (offline
 * again, or a second conflict) leaves the intent exactly where it was, for
 * another attempt rather than a silently lost decision.
 */
export async function keepPhoneVersion(
  store: OutboxStore,
  conflict: DayEditConflict,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const head = await fetchImpl(conflict.url, { method: "GET" });
    const headBody = head.ok ? ((await head.json().catch(() => null)) as { etag?: string } | null) : null;
    const res = await fetchImpl(conflict.url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(headBody?.etag ? { "if-match": headBody.etag } : {}),
      },
      body: JSON.stringify(conflict.phonePatch),
    });
    if (!res.ok) return false;
    await store.remove(conflict.id);
    return true;
  } catch {
    return false;
  }
}

/** D3 — "Keep the server's": the phone's own words are dropped, nothing
 *  further is sent, and the day stays exactly as the server already holds
 *  it. */
export async function keepServerVersion(store: OutboxStore, conflict: DayEditConflict): Promise<void> {
  await store.remove(conflict.id);
}
