/**
 * What a metered call was made *for* — the vocabulary, and nothing else.
 *
 * Split out of `lib/usage.ts` by B996 for one mechanical reason: the console's
 * chart is a client component and needs the labels, while `lib/usage.ts`
 * reaches the database. Importing the second to get the first pulled
 * `better-sqlite3` into the browser bundle and failed the build with a
 * module-not-found in `binding.js` — a long way from anything a person had
 * edited.
 *
 * So this file imports nothing at all, and is safe on either side. Everything
 * that *records* usage still goes through `lib/usage.ts`.
 */

/** Which call site spent it, so a bill can be attributed to a feature. */
const OPERATIONS = [
  "write_day",
  "describe_photos",
  "route_ask",
  // B889 — one turn of the thread. Several per conversation, and a turn that
  // calls a tool books twice: the loop re-sends everything it has.
  "ask_thread",
  "transcribe",
  // B689 — one call per statement, whatever its length: the model returns a
  // column mapping and code applies it to every row.
  "map_statement",
  // B904 — one search asked in a person's own words, over the catalogue of
  // what they may already see. Free to them, like the router; recorded here
  // because the operator still pays for it.
  "find_in_journal",
  // B1517 — one group photograph classified into a proposed party. Charged
  // once a call, whatever the party's size, the same shape as `describe_photos`.
  "travellers_from_photo",
] as const;

export type Operation = (typeof OPERATIONS)[number];

/**
 * What each operation is, in the words an operator would use — B996.
 *
 * The column holds the call site's own name because that is what a bug report
 * needs; the console shows a person what their money bought. Beside the list
 * rather than in the page, so a new operation is one edit — and an unlabelled
 * one falls back to its own name rather than vanishing from a chart.
 */
export const OPERATION_LABEL: Record<string, string> = {
  write_day: "Writing days",
  describe_photos: "Describing photographs",
  route_ask: "Routing a question",
  ask_thread: "Asking the helper",
  transcribe: "Transcribing speech",
  map_statement: "Reading a bank statement",
  find_in_journal: "Searching a journal",
  travellers_from_photo: "Drawing travellers from a photograph",
};
