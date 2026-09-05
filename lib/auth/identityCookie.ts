import "server-only";
import { cookies } from "next/headers";
import { IDENTITY_COOKIE, SESSION_TTL_MS, openIdentitySession } from "./index";

/**
 * Setting and clearing the identity cookie, in one place — B410.
 *
 * Four routes issue this credential: the identity code flow, and the three
 * existing sign-ins that prove the same address for a journal
 * (`/api/auth/verify`, `/api/auth/link`, `/api/contacts/confirm`). Four copies
 * of a cookie's options is four chances for one of them to be written without
 * `httpOnly`, and the one that was would not fail any test — it would simply
 * make the credential readable by script for as long as nobody looked.
 *
 * Only callable where Next permits a cookie write: a route handler or a server
 * action. A layout or a page cannot, which is why the *reading* half lives in
 * `handshake.ts` and this half is imported only by routes.
 */

/**
 * Mint an identity for a proved address and put it in the reader's browser.
 *
 * **Every caller has already proved the address.** That is the precondition
 * and nothing here can check it: this function takes an address and trusts it.
 * The three side-door callers prove it with a code or a link for a journal,
 * which proves the address itself; the identity flow proves it directly.
 *
 * Returns the opaque public id, so a route can hand it to the page for B412 to
 * name a cache after. Never the token — that is in the cookie, and echoing it
 * into a body would put a year-long credential somewhere script can read.
 */
export async function issueIdentityCookie(email: string): Promise<string> {
  const { token, publicId } = await openIdentitySession(email);
  await setIdentityCookie(token);
  return publicId;
}

/**
 * Put an identity token that has already been minted into the browser.
 *
 * The identity code flow mints through `verifyCode`, which redeems the six
 * digits and opens the session in one step; it has a token and needs only the
 * cookie. The side doors have an address and need both, and call
 * `issueIdentityCookie` above.
 */
export async function setIdentityCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(IDENTITY_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS.identity / 1000),
  });
}
