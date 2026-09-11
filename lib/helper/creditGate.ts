import "server-only";
import type { Say } from "./intents";

/**
 * What one model turn costs on the two free-standing conversation doors —
 * `ask_thread` and `find_in_journal` — B1091.
 *
 * Flat and shared between the two: at Haiku's price a whole turn is a
 * fraction of a rappen either way, and one number to change beats two that
 * could quietly drift apart. The *ledger* still tells them apart — each
 * spends under its own `SpendReason` (`lib/credits.ts`) — because that is
 * what an operator reconciling `/admin` against a provider bill actually
 * needs, not what the person is charged.
 */
export const HELPER_TURN_CREDITS = 0.02;

/**
 * The zero-balance answer for a door that would otherwise call a model —
 * B1091.
 *
 * **Never itself a model call.** The balance, the price and the payment link
 * are all the server already knows before anybody's words would have left
 * the machine, so there is nothing here worth spending a turn asking Haiku to
 * phrase — and a door that is out of credit must not spend a second one
 * explaining that to itself. One sentence, in the reader's own language,
 * naming exactly what `lib/whatsapp/refusal.ts`'s `balanceRefusal` names for
 * the WhatsApp door: what it would have cost, what the balance is, and where
 * to top up.
 */
export function noCreditsAnswer(say: Say, balance: number, url: string): string {
  return say("agent.noCredits", {
    cost: HELPER_TURN_CREDITS.toFixed(2),
    balance: balance.toFixed(2),
    url,
  });
}
