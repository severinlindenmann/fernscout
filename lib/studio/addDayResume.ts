/**
 * "Add a day"'s own resume state (A0, B1830) — read from `sessionStorage` by
 * two places that must never disagree about whether a half-done day is
 * still alive: `AddDayFlow`'s own mount effect, and the hub's resume
 * banner (B1902). One storage key, one shape, one expiry rule, in one file
 * rather than duplicated.
 *
 * This is deliberately not `lib/staging/manifest.ts`'s shape — a real
 * server-side staged-run store, with its own warn/extend/final-notice
 * lifecycle for the photographs import. `AddDayFlow`'s own doc comment
 * already explains why that is not invented here: `sessionStorage` in the
 * one tab that started the flow is enough for "leave and come back", and a
 * server-side manifest for this flow is a future ticket's own shape.
 *
 * `sessionStorage` itself carries no calendar expiry — it lives until the
 * tab closes, however long that takes. B1902 asked for the resume screen to
 * *state* when the work expires, which this file makes true by actually
 * enforcing one: a draft older than `ADD_DAY_RESUME_EXPIRY_MS` is treated as
 * forgotten and cleared on the next read, by whichever of the two callers
 * gets there first.
 */

/** How long an abandoned draft is kept before both readers stop offering it. */
export const ADD_DAY_RESUME_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export type AddDaySnapshot = {
  step: string;
  tripId?: string;
  date?: string;
  title?: string;
  content?: string;
  location?: string;
  country?: string;
  savedAt: string;
};

/** The flow's `useStep` id (B2078): its draft is the snapshot, stored under
 *  `useStep`'s own `studio:<flowId>` key, so there is one copy, not two. */
export function addDayFlowId(username: string): string {
  return `addDay:${username}`;
}

export function addDayStorageKey(username: string): string {
  return `studio:${addDayFlowId(username)}`;
}

/** The date (`yyyy-mm-dd`) a saved draft is kept until — pass to
 *  `useI18n().formatLongDate` for the sentence the resume screen and the
 *  hub banner both show. */
export function addDayExpiresOn(savedAt: string): string {
  return new Date(Date.parse(savedAt) + ADD_DAY_RESUME_EXPIRY_MS).toISOString().slice(0, 10);
}

/**
 * Reads `username`'s saved draft, or `null` when there is none — or when
 * there was one but it has aged past its expiry, in which case this also
 * clears it, so an expired draft cannot be found by one reader after the
 * other already decided it was gone.
 */
export function readAddDaySnapshot(username: string): AddDaySnapshot | null {
  try {
    const key = addDayStorageKey(username);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AddDaySnapshot> | null;
    if (!parsed || !parsed.step || parsed.step === "done" || !parsed.savedAt) return null;
    const age = Date.now() - Date.parse(parsed.savedAt);
    if (!Number.isFinite(age) || age > ADD_DAY_RESUME_EXPIRY_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed as AddDaySnapshot;
  } catch {
    // Private mode, or no `sessionStorage` at all — same as AddDayFlow's own
    // mount effect: nothing to resume, never a crash.
    return null;
  }
}
