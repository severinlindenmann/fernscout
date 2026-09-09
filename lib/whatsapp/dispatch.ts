import "server-only";
import { maskNumber } from "./index";
import type { InboundMessage } from "./inbound";

/**
 * What happens to a normalised inbound message, once it has been verified,
 * deduplicated and rate-limited by the webhook route.
 *
 * A separate module from the route on purpose: `app/api/webhooks/whatsapp/
 * route.ts` is allowed to change nothing about *what* an inbound message
 * means, only how it arrives safely. B1057 stops here — "normalise the
 * event into one inbound shape, and stop there. What each becomes is B1058
 * through B1060" — so this function is deliberately a placeholder until
 * B1058 gives it a body: binding the sender's number to a journal, and
 * either the fixed stranger sentence or (from B1061 onward) a model turn.
 */
export async function handleInboundMessage(message: InboundMessage): Promise<void> {
  console.log(`[whatsapp:inbound] ${maskNumber(message.from)} — ${message.kind} (${message.id})`);
}
