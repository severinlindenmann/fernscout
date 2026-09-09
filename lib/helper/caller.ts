import "server-only";
import { isAdminEmail } from "../admin";
import { resolveAccess } from "../auth/handshake";
import { getUser } from "../users";

/**
 * Who is asking the helper, and how they proved it — B1055.
 *
 * `notYourJournal()` in `./server.ts` is careful, deliberate, and cookie-only
 * by construction: it is the right answer for a browser flow, and it is the
 * whole reason a WhatsApp webhook (no cookie, no bearer, a phone number
 * signed by Meta) had no way to speak to the same tools. This is the one
 * function that resolves *either* proof to the same shape the tool layer
 * already accepts — `runTool(username, …)`, `answerInThread(username, …)` —
 * so nothing below the route layer has ever needed to change.
 *
 * **The proof for WhatsApp is a telephone number, and that is weaker than a
 * mailbox.** A `Caller` never widens what a route will do with it — every
 * route that needs an owner's browser keeps asking `isHelperOwner`, which
 * this file now backs, and a `whatsapp` caller is never handed to one. The
 * money and the irreversible things (postcards, deletion, credits) stay
 * behind the existing web pages exactly as before; see B1061.
 *
 * Deliberately not an interface with two implementations pretending to be
 * many — a discriminated union and one resolver per proof is the whole of it,
 * until a third channel actually exists.
 */
export type Caller = { username: string; how: "cookie" } | { username: string; how: "whatsapp" };

/** The only way a `cookie` caller is minted — reads the two session cookies
 *  and nothing else, and re-checks the address against `owner.email` on
 *  every call so a year-old identity cookie opens only what it is entitled
 *  to today (B410). `isHelperOwner` in `./server.ts` is this, asked as a
 *  yes/no question. */
export async function resolveCookieCaller(username: string): Promise<Caller | null> {
  const journal = getUser(username);
  if (!journal) return null;
  const { email } = await resolveAccess(username);
  if (!email) return null;
  if (email !== journal.owner.email && !isAdminEmail(email)) return null;
  return { username, how: "cookie" };
}

/**
 * A caller proven only by an inbound WhatsApp message matched against
 * B1064's registry — automatic, owner-only, no confirmation tap. Built by
 * `lib/whatsapp/dispatch.ts` once `journalForNumber` has already found the
 * one journal this number belongs to; nothing else may construct one.
 */
export function whatsappCaller(username: string): Caller {
  return { username, how: "whatsapp" };
}
