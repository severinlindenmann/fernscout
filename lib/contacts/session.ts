import "server-only";
import { resolveSession } from "../auth";
import { resolveAccess } from "../auth/handshake";
import { hasReadGrant } from "../grants";
import { getUser } from "../users";
import { getContactByEmail, type ContactRecord } from "./index";

/**
 * "Is this the person whose journal it is?"
 *
 * The admin surface lists names, email addresses and — for anyone who asked
 * for a postcard — home addresses. It is the most sensitive page in the
 * application, so the check is deliberately narrow: the session has to belong
 * to *this* user's journal **and** be held by the address named as its owner in
 * `content/<username>/config.json`. A guest session for somebody else's site,
 * or for a reader of this one, is not enough.
 *
 * Two doors, because decision 24 gives the owner two credentials and both are
 * legitimately theirs:
 *
 * - the **guest cookie**, which is how they read their own site in a browser;
 * - an **agent bearer token**, which only the owner address can ever obtain
 *   (`app/api/auth/request` refuses to issue one to anybody else) and which is
 *   how a script or an agent approves someone.
 *
 * A journal with no `owner.email` has no owner, and therefore no admin surface.
 * That is the right default: it fails closed.
 */
export async function isOwner(username: string, request?: Request): Promise<boolean> {
  const user = getUser(username);
  if (!user?.owner.email) return false;
  const ownerEmail = user.owner.email;

  // Either browser credential proves the address: the journal session this
  // reader signed in with, or the instance-wide identity of B410. Which one
  // they hold is not a fact about whether they own this journal — `owner.email`
  // is — so the question is asked of the address, once, through `resolveAccess`.
  const { email } = await resolveAccess(username);
  if (email === ownerEmail) return true;

  const header = request?.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const agent = await resolveSession(bearer, "agent");
  return Boolean(agent && agent.owner === username && agent.email === ownerEmail);
}

/**
 * The person asking, as this journal knows them.
 *
 * **One lookup, one question, two callers** — `resolveViewer`, which tells a
 * reader on `/<user>/me` what they may open, and `mayReadTrip`, which decides
 * it. B41 exists because those two asked *different* questions: the panel
 * asked whether the contact was `active` and the gate never asked at all, so
 * an approved reader was shown a trip and then handed a password form for a
 * password nobody had issued. Anything that needs to know whether somebody is
 * a guest of this journal calls in here, so that there is no second answer to
 * disagree with.
 *
 * Nothing here is looked up by token: this is somebody reading the site in a
 * browser under their own session cookie, not following a link out of an
 * email.
 */
export type JournalReader = {
  /** The address on the session cookie, if it belongs to *this* journal. */
  email: string | null;
  /** Their contact record here, whatever state it is in. */
  contact: ContactRecord | null;
  /** The question. See `isJournalGuest`. */
  guest: boolean;
};

/**
 * Guest, decided once.
 *
 * Two conditions, and they are one answer rather than two because both come
 * from the same act: `approveContact` sets `status: "active"` **and** writes
 * the `read` grant, and both paths that end an approval — `revokeContact`, and
 * changing the address on `updateContactByOwner` — clear both in the same
 * call. Nothing else in the codebase writes `status: "active"`.
 *
 * So why ask both? Because `access_grants.expires_at` is the only field that
 * can say *let in until*, and it is the one thing `status` cannot express. B35
 * dropped the grant lookup from the panel on the grounds that it was the same
 * question as `status`; that is true of every row written today, and stops
 * being true the moment a grant is ever issued with an expiry. The digest has
 * honoured expiry since it was written. Asking `status` here and `expires_at`
 * there would put the panel and the gate back into disagreement in a new
 * place, which is precisely the bug B41 is closing — so both ask for a live
 * grant, and `lib/grants.ts` is where "live" is defined.
 */
export async function journalReader(username: string): Promise<JournalReader> {
  // B410: the address may arrive on this journal's session or on an
  // instance-wide identity, and being a guest here is a question about the
  // address. Everything below is unchanged — an identity opens nothing on its
  // own, and `hasReadGrant` is still asked on every request.
  const { email } = await resolveAccess(username);
  if (!email) return { email: null, contact: null, guest: false };

  const contact = await getContactByEmail(username, email);
  if (!contact || contact.status !== "active") return { email, contact, guest: false };
  return { email, contact, guest: await hasReadGrant(username, contact.id) };
}

/** Whether the person asking has been let into this journal. */
export async function isJournalGuest(username: string): Promise<boolean> {
  return (await journalReader(username)).guest;
}
