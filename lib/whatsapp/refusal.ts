import "server-only";
import { translateIn } from "../locales";
import { serverSite } from "../site";

/**
 * A balance that runs out mid-conversation, said plainly — B1061, spent by
 * B1060's transcription path.
 *
 * The owner's own decision: one sentence naming what the thing would have
 * cost and what the balance is, plain text with the CTA URL inline — Meta
 * auto-links it, and a real interactive button is only worth building if a
 * live send reads badly. `/<user>/account` is where a balance is topped up;
 * an agent token cannot pay (`AGENTS.md`), and this channel has no more
 * ability to than any other.
 *
 * **The request is not held across the payment.** Remembering what somebody
 * asked for and doing it once they have paid is state that has to survive a
 * round trip to a browser and back, and could then act on an intention they
 * have changed their mind about — so this says the refusal and stops; ask
 * again once the balance allows it.
 */
export function balanceRefusal(locale: string, username: string, cost: number, balance: number): string {
  const url = `${serverSite().url}/${username}/account`;
  return translateIn(locale, "wa.balanceRefusal", {
    cost: cost.toFixed(2),
    balance: balance.toFixed(2),
    url,
  });
}
