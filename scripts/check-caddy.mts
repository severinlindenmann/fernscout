/**
 * Does the proxy that is actually running carry the directives this release
 * expects?
 *
 *   npm run check:caddy                       # against /etc/caddy/Caddyfile
 *   npm run check:caddy -- --config ./Caddyfile
 *   npm run check:caddy -- --running r.json --expected e.json   # what tests do
 *
 * **B66.** `deploy/Caddyfile` is a template, and on a machine that already
 * serves another site it is merged by hand, once, on the day the machine is
 * set up. Every later change to it — a header, a cache rule, a security
 * directive — silently fails to reach that machine, and nothing anywhere says
 * so. B01 is what that costs: `header_up X-Forwarded-For {remote_host}` was
 * committed, deployed and reported healthy while the proxy went on appending
 * the header, which meant every rate limit on the server could be reset by
 * forging one.
 *
 * `deploy/fernscout.caddy` is the fix — a file the operator imports rather
 * than copies, so a release updates it. This is the backstop for the operator
 * who declines that and merges by hand anyway: it says, on every deploy,
 * whether the two still agree.
 *
 * **How it compares.** Both sides are Caddy's own JSON — `caddy adapt` turns a
 * Caddyfile into it, and it is what Caddy runs. Every handler object the
 * release's snippet produces must appear, with all of its settings *and the
 * `match` predicate that gates it* (the `path`/`not path`/`method` list that
 * decides which requests reach it — everything except `host`, which differs
 * by design between the release's placeholder domain and a real machine's),
 * somewhere in the running config. B1910: a handler alone is not the fact
 * that matters — `request_body max_size 520MiB` means nothing on its own, it
 * means something for the paths it is attached to, and a route renamed on
 * one side while the handler stayed identical used to compare as "present".
 * Extra handlers — or extra matches — on the machine are fine and expected:
 * the other site's blocks are handlers too, and so is anything the operator
 * added to ours. The question asked is only "is what we ship in there", never
 * "is the machine's config equal to ours" — the second would fail on every
 * shared host, which is the case this exists to serve.
 *
 * Exit codes, because scripts/deploy.sh reads them:
 *   0  the running config carries everything this release expects
 *   1  it does not — the missing directives are named
 *   2  the question could not be asked (no caddy, no config file, bad JSON)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

/** The site block the release ships, and the only thing this check is about. */
export const SHIPPED_SNIPPET = path.join(REPO, "deploy", "fernscout.caddy");

type Json = unknown;
type Handler = Record<string, Json>;

/**
 * Every handler object in a Caddy config, wherever it sits, flattened — each
 * one carrying the `match` predicate that gates it, so what is compared is
 * the (predicate, handler) pair rather than the handler alone. B1910: a
 * `request_body max_size` is not a fact about the site, it is a fact about
 * the paths it is attached to, and comparing the handler without its match
 * let a renamed route keep the same limit while losing the paths that were
 * supposed to get it.
 *
 * Caddy nests them — a `subroute` handler holds routes which hold handlers,
 * and a route's own `match` (if it has one) applies to everything under it —
 * and the nesting depends on how the Caddyfile was written, not on what it
 * does. Two configs that behave identically can differ in shape, so the walk
 * flattens both sides and compares the objects rather than the tree, while
 * accumulating each route's `match` down onto the handlers it contains: a
 * `subroute` nested inside a route that matches `method TRACE TRACK` passes
 * that match down to everything inside it, the same way Caddy itself would
 * apply it.
 *
 * `host` is the one matcher stripped out of what accumulates. It is never
 * meaningful to compare — the release's snippet is adapted against a
 * placeholder domain and a real machine's is not — and the site-block-level
 * `match` in every fixture and every real config is a `host` entry, so
 * leaving it in would make every comparison fail on the domain alone.
 *
 * Nested `routes` are dropped from each handler and walked separately, and a
 * handler left with nothing but its own name is a pure container (`subroute`)
 * and is not returned at all. What it contained is in the list on its own
 * account; keeping the wrapper as well would report one drifted header twice,
 * once as itself and once as "the subroute around it".
 */
export function collectHandlers(config: Json): Handler[] {
  const found: Handler[] = [];

  const isHostOnly = (matcher: Json): boolean =>
    matcher !== null && typeof matcher === "object" && !Array.isArray(matcher) && "host" in matcher;

  const walkHandler = (node: Json, matches: Json[]): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    const obj = node as Handler;
    if (typeof obj.handler !== "string") return;
    if (obj.handler === "subroute") {
      walkRoutes(obj.routes, matches);
      return;
    }
    const own: Handler = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "routes") own[key] = value;
    }
    if (matches.length > 0) own.match = matches;
    if (Object.keys(own).length > 1) found.push(own);
  };

  const walkRoutes = (node: Json, inherited: Json[]): void => {
    if (Array.isArray(node)) {
      node.forEach((route) => walkRoutes(route, inherited));
      return;
    }
    if (node === null || typeof node !== "object") return;
    const route = node as Record<string, Json>;
    const ownMatch = Array.isArray(route.match) ? route.match.filter((m) => !isHostOnly(m)) : [];
    const matches = ownMatch.length > 0 ? [...inherited, ...ownMatch] : inherited;
    if (Array.isArray(route.handle)) {
      route.handle.forEach((h) => walkHandler(h, matches));
    }
    // Fall through everything else — a server's own top-level `routes`
    // (there is no enclosing "route" object above it, so it only reaches a
    // handler through this path), `apps.http.servers`, and anything future
    // Caddy adds — so a handler never goes uncompared just because it sits
    // somewhere this walk did not name. `handle` and `match` are excluded
    // because they were just consumed above; a handler's own `routes` (a
    // `subroute` container) is consumed by `walkHandler`, not reached here.
    for (const [key, value] of Object.entries(route)) {
      if (key === "handle" || key === "match") continue;
      walkRoutes(value, matches);
    }
  };

  walkRoutes(config, []);
  return found;
}

/**
 * Is everything in `expected` present in `actual`, and equal?
 *
 * Objects: every key of `expected` must be there. Arrays: every element must
 * be matched by some element of `actual`, in any order — Caddy writes
 * `upstreams` and header lists as arrays whose order it does not promise.
 * Scalars: equal.
 *
 * One-directional on purpose. A machine that adds a header of its own to our
 * reverse_proxy has not drifted from the release; a machine that dropped one
 * of ours has.
 */
export function isSubset(expected: Json, actual: Json): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((want) => actual.some((have) => isSubset(want, have)));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    const a = actual as Record<string, Json>;
    return Object.entries(expected as Record<string, Json>).every(
      ([key, want]) => key in a && isSubset(want, a[key]),
    );
  }
  return expected === actual;
}

/** The handlers this release expects and the running config does not have. */
export function missingHandlers(expected: Json, running: Json): Handler[] {
  const have = collectHandlers(running);
  return collectHandlers(expected).filter((want) => !have.some((got) => isSubset(want, got)));
}

/** One line a person can act on, out of a handler object nobody wants to read
 * as JSON. Named cases for the handlers this snippet actually produces. */
/**
 * The paths a handler's accumulated `match` names, for the one line a person
 * reads. B1910 was exactly this going unsaid: a `request_body max_size`
 * reported as missing without its paths tells nobody which route lost its
 * tier, or that it moved rather than vanished.
 */
function describeMatch(matches: Json): string {
  if (!Array.isArray(matches) || matches.length === 0) return "";
  const paths: string[] = [];
  let negated = false;
  for (const m of matches) {
    if (m === null || typeof m !== "object" || Array.isArray(m)) continue;
    const entry = m as Record<string, Json>;
    if (Array.isArray(entry.path)) paths.push(...entry.path.map(String));
    if (Array.isArray(entry.not)) {
      negated = true;
      for (const n of entry.not) {
        if (n && typeof n === "object" && Array.isArray((n as Record<string, Json>).path)) {
          paths.push(...((n as Record<string, Json>).path as Json[]).map(String));
        }
      }
    }
  }
  if (paths.length === 0) return "";
  return ` for ${negated ? "everything except " : ""}${paths.join(", ")}`;
}

export function describeHandler(handler: Handler): string {
  const kind = String(handler.handler);
  const forPaths = describeMatch(handler.match);
  if (kind === "reverse_proxy") {
    const upstreams = Array.isArray(handler.upstreams)
      ? handler.upstreams
          .map((u) => (u && typeof u === "object" ? String((u as Record<string, Json>).dial ?? "?") : "?"))
          .join(", ")
      : "?";
    const headers = handler.headers as Record<string, Json> | undefined;
    const request = headers?.request as Record<string, Json> | undefined;
    const set = request?.set as Record<string, Json> | undefined;
    const names = set ? Object.keys(set).join(", ") : "";
    return `reverse_proxy to ${upstreams}${names ? ` setting ${names} upstream` : ""}${forPaths}`;
  }
  if (kind === "encode") {
    const encodings = handler.encodings as Record<string, Json> | undefined;
    return `encode ${encodings ? Object.keys(encodings).join(" ") : ""}`.trim() + forPaths;
  }
  if (kind === "request_body") {
    return `request_body max_size ${String(handler.max_size)}${forPaths}`;
  }
  return `${kind}${forPaths}: ${JSON.stringify(handler)}`;
}

/**
 * `caddy adapt` on a Caddyfile, or null with the reason on stderr.
 *
 * Placeholders are given stand-in values when the environment has none. Both
 * files are full of them — `{$CADDY_DOMAIN}`, `{$CADDY_ACME_EMAIL}` — and on
 * the VPS they are set in *Caddy's* environment, which this process is not in.
 * An empty `{$CADDY_ACME_EMAIL}` is an adapter error rather than an empty
 * string, so without this the check would answer "could not ask" on the one
 * machine it exists for. Substituting them is safe because neither the site
 * address nor the ACME account is compared: only handlers are.
 */
function adapt(file: string): Json | null {
  const res = spawnSync("caddy", ["adapt", "--config", file, "--adapter", "caddyfile"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CADDY_DOMAIN: process.env.CADDY_DOMAIN || "fernscout.invalid",
      CADDY_ACME_EMAIL: process.env.CADDY_ACME_EMAIL || "ops@example.invalid",
    },
  });
  if (res.error || res.status !== 0) {
    process.stderr.write(`could not adapt ${file}: ${res.stderr || res.error?.message || "unknown error"}\n`);
    return null;
  }
  try {
    return JSON.parse(res.stdout) as Json;
  } catch (err) {
    process.stderr.write(`caddy adapt produced no JSON for ${file}: ${String(err)}\n`);
    return null;
  }
}

function readJson(file: string): Json | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
  } catch (err) {
    process.stderr.write(`cannot read ${file}: ${String(err)}\n`);
    return null;
  }
}

function main(argv: string[]): number {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const runningFile = valueOf("--running");
  const expectedFile = valueOf("--expected");
  const configFile = valueOf("--config") ?? (process.env.CADDY_CONFIG || "/etc/caddy/Caddyfile");

  // Both sides are adapted the same way, so the placeholders cancel out. PORT
  // is the one that is passed straight through and not stood in for, because
  // the upstream genuinely depends on it: a deployment that moved the app off
  // 3000 has a different — and correct — reverse_proxy line, and both sides
  // must be read with the same value or every such machine reports drift.
  const expected = expectedFile ? readJson(expectedFile) : adapt(SHIPPED_SNIPPET);
  if (expected === null) return 2;

  let running: Json | null;
  if (runningFile) {
    running = readJson(runningFile);
  } else if (!fs.existsSync(configFile)) {
    process.stderr.write(`no Caddy config at ${configFile} — pass --config, or set CADDY_CONFIG\n`);
    return 2;
  } else {
    running = adapt(configFile);
  }
  if (running === null) return 2;

  const missing = missingHandlers(expected, running);
  if (missing.length === 0) {
    process.stdout.write(`caddy: the running config carries what this release expects\n`);
    return 0;
  }

  process.stderr.write(
    `WARNING: the proxy config is not what this release expects. Missing from ${runningFile ?? configFile}:\n`,
  );
  for (const handler of missing) process.stderr.write(`  - ${describeHandler(handler)}\n`);
  process.stderr.write(
    "\nThe release's site block is deploy/fernscout.caddy. The fix that does not\n" +
      "come back is one line in the machine's Caddyfile:\n" +
      `  import ${SHIPPED_SNIPPET}\n` +
      "replacing the hand-merged block, then `sudo caddy validate --config " +
      `${configFile}` +
      "` and `sudo systemctl reload caddy`.\nSee docs/runbook.md, and B66.\n",
  );
  return 1;
}

// Only when run as a program. Importing it from a test must compare, not exit.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
