/**
 * Whose turn it is, for every contact of a journal — B2133.
 *
 * One vocabulary for the readers page, the hub's "N asking" chip and the
 * invite section's "already here" note, so the three can never name the same
 * person two ways again. Pure, and free of server imports, because the page's
 * client half re-splits the list after every action with this same function.
 *
 * - `waitingOnYou`: asked and confirmed their address — the owner's answer is
 *   what is missing (Approve).
 * - `waitingOnThem`: on the list but never confirmed — they owe the next step.
 * - `readingNow`: active.
 * - `revoked`: blocked (Revoke writes this); Approve is the way back (B213).
 *
 * The owner's own row is left out of all four: it is not a reader.
 */
type Row = { email: string; status: "pending" | "active" | "blocked"; confirmedAt: string | null };

export type ReaderState = "waitingOnYou" | "waitingOnThem" | "readingNow" | "revoked";

export function readerState(row: Row): ReaderState {
  if (row.status === "active") return "readingNow";
  if (row.status === "blocked") return "revoked";
  return row.confirmedAt ? "waitingOnYou" : "waitingOnThem";
}

export function splitReaders<T extends Row>(rows: T[], ownEmail: string | null): Record<ReaderState, T[]> {
  const out: Record<ReaderState, T[]> = { waitingOnYou: [], waitingOnThem: [], readingNow: [], revoked: [] };
  for (const row of rows) {
    if (ownEmail && row.email === ownEmail) continue;
    out[readerState(row)].push(row);
  }
  return out;
}
