/**
 * The nightly pending-signup sweep — B2804.
 *
 *   npm run signup:purge
 *
 * Removes every pending_signups row whose address was proven more than eight
 * days ago. Run nightly by `scripts/backup.sh`, next to the first-trip sweep.
 * Run through `tsx --conditions=react-server` for the same reason
 * `first-trip.mts` is: the modules it reaches are `server-only`.
 */
import { purgePendingSignups } from "../lib/signup/pending";

const removed = await purgePendingSignups();
console.log(`${removed} pending signup(s) older than eight days removed.`);
