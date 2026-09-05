import "server-only";

/**
 * The one address that owns every journal on this instance — B480.
 *
 * Access here is per journal and deliberately so: `owner.email` in a journal's
 * own `config.json` is the whole answer, and nothing sits above it. That is
 * right for an instance strangers sign up to, and wrong for one where a single
 * person holds the machine and a single address does the work — they could not
 * read a journal they did not own, publish into one, or even obtain a code for
 * one, because `mayRequestAgentToken` refuses an address the journal does not
 * recognise.
 *
 * **Environment, never `content/config.json`.** Not because an address is a
 * secret — it is not, and it will appear in a mail header the first time it is
 * used — but because this is an authorisation control. It changes on the
 * server without a content commit, it does not travel in the repository to
 * somebody else's instance, and a journal's own config can therefore never
 * widen it. `content/config.json` is content; this is operations.
 *
 * **Absent is the default and the safe one.** No variable, no admin, and every
 * gate below behaves exactly as it did before this file existed — which is
 * what makes it safe to leave unset on every instance that is not this one.
 *
 * What it opens, once set, is everything `isOwner` opens, on every journal:
 * drafts, `private` trips, publishing, the contacts page with its home
 * addresses, invites, credits. There is no narrower rung, deliberately — a
 * half-admin would be a second access model to keep in agreement with the
 * first, and AGENTS.md has the record of what that costs.
 *
 * Two things it is not, and both matter:
 *
 * - **not a person on a trip.** `peopleNamedIn` and `peopleOf` are untouched,
 *   so this address is not mailed the day digest for every journal on the
 *   instance, and never appears in a byline.
 * - **not an owner on disk.** `journalsOwnedBy` still reads `config.json`, so
 *   the three-journals-per-address cap counts the journals this address
 *   actually created.
 */
function adminEmail(): string | null {
  const raw = process.env.FERNSCOUT_ADMIN_EMAIL?.trim().toLowerCase();
  return raw ? raw : null;
}

/**
 * Whether this address is the instance admin.
 *
 * Read from the environment on every call rather than at module load: a test
 * sets the variable after import, and a server that is handed one at restart
 * should not depend on which module was evaluated first. It is a string
 * comparison, not a query.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const admin = adminEmail();
  return Boolean(admin && email && email.trim().toLowerCase() === admin);
}
