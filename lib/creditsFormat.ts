/**
 * How a person reads a franc figure — B987, in CHF only since B2617 deleted
 * the last credit-denominated display (`formatCredits`).
 *
 * Its own file, beside the money code it serves, for the reason a database
 * module starts with `import "server-only"`: a figure like this is rendered
 * in the browser (the photobook's print card, the postcard order page, print
 * receipts), and importing a formatter from a module that owns the database
 * pulled the whole of it — config, capabilities, Kysely — into the client
 * bundle. The build says so plainly and immediately, which is the good
 * version of this mistake.
 *
 * Nothing here touches a database or a request. It is arithmetic and a
 * string.
 */
export function formatChf(rappen: number): string {
  return `CHF ${(rappen / 100).toFixed(2)}`;
}
