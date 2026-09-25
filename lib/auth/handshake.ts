import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { GUEST_COOKIE, IDENTITY_COOKIE, resolveSession, type Session } from "./index";

/**
 * Who is asking about **this** journal, from either credential — B410.
 *
 * Before this there was one question and one place to ask it: `fs_session`,
 * which names a journal in `sessions.owner_id`. That made a reader's access a
 * property of the last journal they signed into. Somebody who is a guest of
 * one journal, a buddy on a trip in a second and the owner of a third held
 * credentials for exactly one of them at a time, and the server had no way to
 * be asked about the other two.
 *
 * The identity credential (`fs_identity`) proves an address and authorises
 * nothing. This is the one place that turns it into an answer about a
 * particular journal, and the answer it returns is deliberately thin: **an
 * address, not a permission.** Everything that decides what an address may
 * actually do is unchanged and still runs per request — `journalReader` asks
 * `hasReadGrant`, `isOwner` reads `owner.email` out of `config.json`,
 * `isPersonOnWith` reads the trip's `people:`. A year-old identity therefore
 * opens exactly what its holder is entitled to *today*.
 *
 * ## Why there is no session minted here
 *
 * The design this was built from had the identity mint a per-journal `guest`
 * session and hand it back as a cookie, on the reasoning that later requests
 * would then take the cheap path the existing gates already knew. There is no
 * cheap path to take: with or without that cookie, a request costs one indexed
 * `sessions` lookup plus whatever the gate then asks about the address. The
 * minted session saved nothing and created rows that a revocation would have
 * had to chase. So an identity is resolved on every request, like a session,
 * because that is what it is.
 *
 * ## Why not in `proxy.ts`
 *
 * Next's own documentation is explicit: proxy runs on every route including
 * prefetched ones, and must not do database work
 * (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md:29`).
 * A resolver that ran there would issue a query per prefetch of every link on
 * the page.
 */
export type JournalAccess = {
  /**
   * The address acting on this journal, or null when nobody is signed in.
   *
   * This is the whole output. It is not a statement that the address may read
   * anything here — an identity resolves for every journal on the instance,
   * including ones its holder has no role in at all, and the gate is what says
   * no.
   */
  email: string | null;
  /**
   * The journal-scoped session, when the request carries one for *this*
   * journal. Null when the address arrived by identity, which is the ordinary
   * case once B411 ships. Kept because two callers still need the session row
   * itself rather than the address: `/api/push/subscribe` and the sign-out.
   */
  session: Session | null;
  /** The identity, when the request carries one. Null otherwise. */
  identity: Session | null;
};

/**
 * Resolved once per request, like `resolveSession` and for the same reason
 * (B53): this ends in `UPDATE sessions SET last_seen_at`, so it is a write
 * transaction, and a single page render asks it from four or five call sites
 * that all legitimately need to know who is asking.
 *
 * `cache()` is per request and cannot outlive one — see the long note on
 * `resolveSession`, every word of which applies here. Outside a request, in a
 * script or a test, it memoises nothing at all.
 */
async function lookUpAccess(username: string): Promise<JournalAccess> {
  const jar = await cookies();

  /**
   * The journal cookie wins when it belongs to this journal.
   *
   * Not because it is more trustworthy — both prove the same address — but
   * because it is what every reader signed in before B410 is holding, and a
   * request that already carries the right answer should not go looking for
   * another one.
   */
  const session = await resolveSession(jar.get(GUEST_COOKIE)?.value, "guest");
  const forThisJournal = session?.owner === username ? session : null;

  const identity = await resolveSession(jar.get(IDENTITY_COOKIE)?.value, "identity");

  return {
    email: forThisJournal?.email ?? identity?.email ?? null,
    session: forThisJournal,
    identity,
  };
}

export const resolveAccess = cache(lookUpAccess);

/**
 * The identity alone, for the surfaces that are not about a journal — B411's
 * home view and the device list.
 *
 * Separate from `resolveAccess` because it asks a different question and must
 * not be satisfiable by a journal cookie. `fs_session` proves an address too,
 * but only for one journal; answering "what may this person open across the
 * instance?" from it would be answering a question it cannot know — and would
 * quietly turn one journal's year-long read cookie into a directory of every
 * other journal that address touches.
 */
async function lookUpIdentity(): Promise<Session | null> {
  const jar = await cookies();
  return resolveSession(jar.get(IDENTITY_COOKIE)?.value, "identity");
}

export const resolveIdentity = cache(lookUpIdentity);
