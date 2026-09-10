/**
 * Ask the printer what became of every book it took, and settle the ones it
 * refused — B1336.
 *
 *   npm run photobook:reconcile
 *
 * Safe to run at any time and as often as you like: it only ever acts on an
 * order the printer has *finally* refused, and settling one moves it out of
 * the set this reads, so a second run finds nothing to do.
 *
 * Meant for a timer. `scripts/backup.sh` is the other thing on one, and this
 * belongs beside it rather than inside a request: a person pressing a button
 * cannot be kept waiting for an answer that takes minutes.
 */
import { reconcileSubmittedPrints } from "../lib/photobook/reconcile.ts";
import { closeDatabase } from "../lib/db/index.ts";

const result = await reconcileSubmittedPrints();
console.log(
  `photobook reconcile: ${result.checked} in flight, ${result.settled} settled as refused, ` +
    `${result.unreachable} could not be asked`,
);
await closeDatabase();
