/**
 * A journal's public address: `/@<username>`.
 *
 * The `@` is what keeps people and the app out of each other's way. Every
 * top-level path that does not start with `@` belongs to the app — `/prices`,
 * `/docs`, whatever gets added next — and every one that does is a person's
 * journal. Before this, journals sat at `/<username>` and shared the root with
 * the app's own pages, so a reserved-name list had to be kept in step with
 * every new page, and a page added after somebody picked its name made their
 * journal unreachable.
 *
 * The pages themselves live at `app/at/[user]/`, an internal path the browser
 * never sees: `proxy.ts` rewrites `/@anna/…` to `/at/anna/…`, and answers a
 * direct request for `/at/…` with a redirect to the `@` form, so there is one
 * address per page. A folder cannot be called `@[user]` — Next reads a leading
 * `@` as a parallel-route slot.
 *
 * Only the URL carries the `@`. The username itself — the folder under
 * `content/`, the database rows, the `{user}` in `/api/v2/{user}/…` — does not.
 *
 * No imports, on purpose: this is read by `proxy.ts`, server pages, client
 * components and tests alike.
 */

/** Same shape as a trip id: lowercase, digits, dashes, no leading dash.
 *
 * Exported since B1720 so the published contract can state it rather than
 * carry a second copy: every `{user}` in `/api/v2/openapi.json` declares this
 * pattern, read from here. A caller building a URL from the document is then
 * checking against the same rule the server resolves with. Lives here rather
 * than in `lib/users.ts` (which re-exports it) because that module is
 * `server-only` and `proxy.ts` needs it too. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** The character that marks a path segment as a journal. */
const JOURNAL_MARK = "@";

/** The internal route segment `proxy.ts` rewrites journal paths into. Never
 * linked to; a browser that asks for it is redirected to the `@` form. */
export const JOURNAL_ROUTE_ROOT = "at";

/**
 * `/@anna`, or `/@anna/trips/x` with `rest = "/trips/x"`. `rest` is appended
 * as given, so it can also carry a query or a fragment (`"?lang=de"`, `"#day"`).
 */
export function journalPath(username: string, rest = ""): string {
  return `/${JOURNAL_MARK}${username}${rest}`;
}

/**
 * The journal a path belongs to, and what follows its name — or null for any
 * path that is not a journal's. Accepts `%40` for the `@`, which some apps
 * write when they copy a link.
 */
export function parseJournalPath(
  pathname: string | null | undefined,
): { username: string; rest: string } | null {
  const match = /^\/(?:@|%40)([^/?#]+)(.*)$/i.exec(pathname ?? "");
  if (!match) return null;
  return { username: match[1], rest: match[2] };
}

/** The username in a path, when the path is a journal's. */
export function journalInPathname(pathname: string | null | undefined): string | null {
  return parseJournalPath(pathname)?.username ?? null;
}
