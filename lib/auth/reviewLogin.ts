import "server-only";
import { isAdminEmail } from "../admin";
import { getUser, getUsernames } from "../users";

/**
 * One address whose sign-in code is fixed — for App Review, B2125.
 *
 * Apple's reviewer has to open the studio (guideline 2.1) and has no mailbox
 * on this server, so the six-digit code that goes by mail never reaches
 * them. `AUTH_DEV_CODE` fixes *every* code and must never be set on a live
 * instance. This fixes one: `REVIEW_LOGIN_EMAIL` gets `REVIEW_LOGIN_CODE`,
 * and nothing changes for any other address — their code is still random
 * and still mailed.
 *
 * What keeps a constant credential from being a hole is what it can open,
 * decided here and nowhere else:
 *
 * - the address must not be the instance's admin (`FERNSCOUT_ADMIN_EMAIL`
 *   reaches every journal, and a fixed code for it would be a master key);
 * - every journal whose `owner.email` is this address must be named
 *   `test-<something>`, the agreed marker for a journal nobody lived
 *   (AGENTS.md) — one real journal owned by the address and the fixed code
 *   is refused for it entirely, not narrowed;
 * - the address must already own at least one such journal — before the
 *   test journal exists there is nothing for a reviewer to look at, and a
 *   fixed code that could sign up a new journal would be more than the
 *   feature needs;
 * - a code asked for a specific journal (`for: "read"` or `"write"`) is
 *   fixed only for a journal the address owns, not for every `test-`
 *   journal on the instance.
 *
 * Refusal is silent by design: the caller falls back to a random code and
 * the mail goes out as usual, so a misconfiguration fails towards "the
 * reviewer cannot sign in", never towards "somebody else can".
 */
export function reviewLoginCode(
  email: string,
  journal: string | null,
  ownedJournals: readonly string[],
  env: { email?: string; code?: string; admin: boolean } = {
    email: process.env.REVIEW_LOGIN_EMAIL,
    code: process.env.REVIEW_LOGIN_CODE,
    admin: isAdminEmail(email),
  },
): string | null {
  const configured = env.email?.trim().toLowerCase();
  const code = env.code?.trim();
  if (!configured || !code) return null;
  if (!/^\d{6}$/.test(code)) return null;
  if (email.trim().toLowerCase() !== configured) return null;
  if (env.admin) return null;
  if (ownedJournals.length === 0) return null;
  if (!ownedJournals.every((name) => name.startsWith("test-"))) return null;
  if (journal !== null && !ownedJournals.includes(journal)) return null;
  return code;
}

/** `reviewLoginCode` with the ownership read from the content root. */
export function reviewLoginCodeFor(email: string, journal: string | null): string | null {
  if (!process.env.REVIEW_LOGIN_EMAIL || !process.env.REVIEW_LOGIN_CODE) return null;
  const address = email.trim().toLowerCase();
  const owned = getUsernames().filter(
    (username) => getUser(username)?.owner.email?.trim().toLowerCase() === address,
  );
  return reviewLoginCode(email, journal, owned);
}

/** For `/api/health`: on, and what it is limited to — never the address. */
export function reviewLoginNote(): string | undefined {
  return process.env.REVIEW_LOGIN_EMAIL && process.env.REVIEW_LOGIN_CODE
    ? "one reviewer address signs in with a fixed code (REVIEW_LOGIN_EMAIL); it opens test- journals only"
    : undefined;
}
