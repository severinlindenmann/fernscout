/**
 * The one line a request leaves behind, when `features.logging` is on (B257).
 *
 * No `server-only` here, for the same reason as `lib/tombstones.ts`: this is
 * imported by `proxy.ts`, which runs in the Node.js runtime and is not the
 * place to pull in anything that assumes a browser-free *or* edge-free build.
 *
 * **Why there is no status, no duration and no response size.** Next's own
 * docs say it plainly — "Proxy allows you to run code before a request is
 * completed" — and the execution-order table puts it three steps before a
 * filesystem route is even chosen. A `console.log` here fires before the
 * page has rendered or the route handler has replied, so there is no status
 * code, no elapsed time and no byte count in existence yet to report. `after()`
 * called from *inside* proxy resolves on proxy's own return, not on the
 * request it let through — timed, empirically, at single-digit milliseconds
 * against a multi-second real response. Getting those three fields would need
 * a hook inside every route handler instead, which is the "a call per
 * handler" this ticket's Work section explicitly chose not to build. What is
 * logged is everything proxy actually has at the moment it decides to let a
 * request through: the method, the path and the user agent.
 */

/** Control characters stripped so a crafted header cannot forge a second log
 * line — a value is never trusted just because it only has to travel one
 * line before being ignored. */
function sanitize(value: string): string {
  const cleaned = value.replace(/[\r\n\t]/g, " ").trim();
  return cleaned === "" ? "-" : cleaned;
}

/**
 * `method path ua="…"` — deliberately not JSON. This is read with
 * `journalctl -u fernscout`, which already timestamps every line; nothing
 * here repeats that. Never an IP address and never a query string — see
 * docs/runbook.md for why.
 */
export function formatRequestLine(method: string, path: string, userAgent: string | null): string {
  return `[request] ${sanitize(method)} ${sanitize(path)} ua="${sanitize(userAgent ?? "-")}"`;
}
