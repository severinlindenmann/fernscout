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
 * release's snippet produces must appear, with all of its settings, somewhere
 * in the running config. Extra handlers on the machine are fine and expected:
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
 * Every handler object in a Caddy config, wherever it sits, flattened.
 *
 * Caddy nests them — a `subroute` handler holds routes which hold handlers —
 * and the nesting depends on how the Caddyfile was written, not on what it
 * does. Two configs that behave identically can differ in shape, so the walk
 * flattens both sides and compares the objects rather than the tree.
 *
 * Nested `routes` are dropped from each handler and walked separately, and a
 * handler left with nothing but its own name is a pure container (`subroute`)
 * and is not returned at all. What it contained is in the list on its own
 * account; keeping the wrapper as well would report one drifted header twice,
 * once as itself and once as "the subroute around it".
 */
export function collectHandlers(config: Json): Handler[] {
  const found: Handler[] = [];
  const walk = (node: Json): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const obj = node as Handler;
    if (typeof obj.handler === "string") {
      const own: Handler = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key !== "routes") own[key] = value;
      }
      if (Object.keys(own).length > 1) found.push(own);
    }
    Object.values(obj).forEach(walk);
  };
  walk(config);
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
export function describeHandler(handler: Handler): string {
  const kind = String(handler.handler);
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
    return `reverse_proxy to ${upstreams}${names ? ` setting ${names} upstream` : ""}`;
  }
  if (kind === "encode") {
    const encodings = handler.encodings as Record<string, Json> | undefined;
    return `encode ${encodings ? Object.keys(encodings).join(" ") : ""}`.trim();
  }
  return `${kind}: ${JSON.stringify(handler)}`;
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
