import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { readBackupStatus } from "@/lib/backupStatus";
import { basemapProblem } from "@/lib/basemap";
import { resolveCapabilities } from "@/lib/capabilities";
import { loadServerConfig } from "@/lib/config";
import { FEATURE_NAMES } from "@/lib/config";
import { TRANSACTIONAL_MAIL_NOTE } from "@/lib/mail/types";
import { contentRootProblem, getUsernames, listedUsernames } from "@/lib/users";
import pkg from "@/package.json";

// Never cache or prerender: this reflects the live state of the process
// (env vars, config) at request time, not a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * `/api/health` — for an uptime monitor, and for the person who deployed this
 * at 2am to see *why* a feature isn't lighting up without grepping env vars.
 *
 * Reports each capability's resolved on/off state and, when off, the reason
 * (`resolveCapabilities()` from lib/capabilities.ts) — never a secret value,
 * only whether one is present. Also reports whether config.json parsed at
 * all, since a broken config is the one failure that can take capability
 * resolution down with it.
 *
 * **Backups, too.** `backup` reports when `scripts/backup.sh` last finished,
 * because nothing else could answer it from outside the machine — a nightly
 * backup that has aborted since March leaves a timer that still looks
 * perfectly healthy (B64). It is reported as a field rather than folded into
 * `status`: a stale backup is not a reason to take an instance out of a load
 * balancer or fail a deploy, but it is very much a reason to page somebody.
 * A monitor should assert on `.backup.state` being `"ok"`.
 *
 * **Per journal as well as per server.** A capability is a server ceiling and
 * a journal opt-in, and this reported only the ceiling — so `contacts` read
 * "enabled" while `/<user>/contacts` answered 404, because that journal had
 * never switched it on. The person reading this page at 2am concluded the routing
 * was broken. `journals` gives the answer they were actually looking for.
 *
 * **A content root it cannot read is `content: { ok: false }` and a 503.**
 * `getUsernames()` cannot throw — a failed directory listing must not take
 * every page down with it — so it returns an empty list, which reads exactly
 * like an instance nobody has created a journal on. Everything downstream then
 * answers politely and wrongly: no journal resolves, `journals` below is empty
 * because there is nothing to compare, and this page said `ok`. B197 is what
 * that cost, in the form of every journal's mail silently switched off. The
 * empty `journals` block is the symptom an operator sees; this field is the
 * only thing that can tell them it means "cannot tell" rather than "nothing to
 * report".
 *
 * **A basemap that will not read is `basemap: { ok: false }` and a 200.**
 * `bundle()` in lib/basemap.ts returns null both for a bundle nobody built —
 * a supported state — and for one it could not read, and before B179 those
 * were the same silent branch, cached for the life of the process: one failed
 * read and every map on the instance drew blank until a restart. The fault now
 * has a name and is reported here. It is a field rather than part of `status`,
 * for the reason `backup` is: a map with no borders under it is not a reason
 * to take an instance out of a load balancer, and very much a reason to tell
 * somebody. Nothing here forces a read — this reports the last attempt any
 * page made, so an instance that has drawn no map since booting says `ok`.
 *
 * A journal whose `mail` is narrowed off also carries `stillSent`, because
 * that block is only true of the letters the journal writes to its readers:
 * sign-in codes, deletion confirmations and operator alerts go out anyway.
 * Reporting `enabled: false` and nothing else is what sent somebody hunting
 * for a routing bug when a code arrived for a journal that said mail was off
 * (B60).
 *
 * ## What is public here, and what is not (B234)
 *
 * This page is unauthenticated and stays that way — an uptime monitor cannot
 * hold a credential, and every field below that a monitor asserts on is
 * reachable without one. But two of its fields had drifted past "on or off"
 * into things this instance does not otherwise hand out, and both appear
 * precisely when the instance is already unhealthy, which is when somebody
 * probing is most likely to be reading.
 *
 * **Public, to anybody:** `status`, `time`, `uptimeSeconds`, `version`,
 * `commit`, `backup`, `responseTimeMs`, every block's `ok` boolean and its
 * machine-readable `code`, and the whole `capabilities` block including each
 * reason. Reasons are named env vars and config keys — never a value, never a
 * path, never a person — and AGENTS.md requires that a capability which is off
 * explains itself. That promise is kept in full.
 *
 * **Behind `HEALTH_TOKEN`:** the free-text `error` on `config`, `content` and
 * `basemap`, which carries the absolute content-root path and errno text; and
 * the `journals` rows of journals this instance does not advertise. Present it
 * as `Authorization: Bearer <token>`. Unset means nobody is entitled, never
 * everybody — a fresh install is safe before it is configured.
 *
 * **The diagnostic that B197 added survives the redaction**, which is the
 * point of drawing the line here rather than dropping the field. B197's
 * complaint was that an empty `journals` block reads exactly like an instance
 * with no journals, so nothing could say "cannot tell" rather than "nothing to
 * report". `content: { ok: false }` is what says it, and that is public. Only
 * the path is held back, and `getUsernames()` has already written the whole
 * message to stdout, where the operator entitled to it already is.
 *
 * **`journals` is filtered by `listedUsernames()`**, which is the function
 * whose docstring already says "use this for anything that hands out the
 * existence of a journal". A journal whose config says `visibility: private`
 * is meant to be absent from `/documentation.txt`, the landing page and
 * `sitemap.xml`; it had its name here instead, as soon as it narrowed a
 * capability. `journalsWithheld` counts what the filter dropped, so the
 * redaction is visible to the operator debugging a 404 rather than silently
 * handing them a list that looks complete. A count names nobody and cannot be
 * turned into a URL.
 */

/**
 * Whether this caller may read the detail as well as the state.
 *
 * A shared operator secret rather than an owner's bearer token, because the
 * question this page answers is about the *instance* — its filesystem, its
 * config, its journal list — and no single journal's owner is the authority on
 * that. On a one-journal instance the two are the same person; on a shared one
 * they are not, and the wrong one of those two is the one that leaks.
 *
 * Compared in constant time, and an unset `HEALTH_TOKEN` entitles nobody: the
 * safe default for a fresh install is the redacted page, not the full one.
 */
function mayReadDetail(request: Request): boolean {
  const expected = process.env.HEALTH_TOKEN ?? "";
  if (expected === "") return false;
  const supplied = /^bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (supplied === "") return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A fault, as much of it as this caller is entitled to. */
function fault(code: string, message: string, detailed: boolean) {
  return { ok: false as const, code, ...(detailed ? { error: message } : {}) };
}

export async function GET(request: Request) {
  const detailed = mayReadDetail(request);
  const startedAt = Date.now();

  let capabilities: Record<string, { enabled: boolean; reason?: string; keepingCopies?: true }>;
  let configOk = true;
  let configError: string | undefined;

  try {
    const resolved = resolveCapabilities();
    capabilities = {};
    for (const name of FEATURE_NAMES) {
      const state = resolved[name];
      capabilities[name] = state.enabled
        ? { enabled: true }
        : { enabled: false, reason: state.reason };
    }

    // Surfaced because it is a security-relevant setting an operator can
    // otherwise only discover by reading the config file: with it on, every
    // sign-in code, invitation and deletion link is also written to disk in
    // plaintext. Reported as a flag, never as the value of anything.
    if (capabilities.mail?.enabled && loadServerConfig().features.mail.keepCopy === true) {
      capabilities.mail.keepingCopies = true;
    }
  } catch (err) {
    // loadConfig() throws ConfigError for a missing/invalid content/config.json.
    // That is a real health problem, not a 500 — report it as unhealthy instead
    // of crashing the health check itself.
    configOk = false;
    configError = err instanceof Error ? err.message : String(err);
    capabilities = {};
  }

  // Only the differences: on a single-user instance, or one where nobody has
  // narrowed anything, this is empty and the server-level block above is the
  // whole truth.
  const journals: Record<
    string,
    Record<string, { enabled: boolean; reason?: string; stillSent?: string }>
  > = {};
  // Read after `getUsernames()`, never before it: the fault is recorded by the
  // read, so asking first answers about whatever happened last time.
  let contentProblem: string | null = null;
  if (configOk) {
    const usernames = getUsernames();
    contentProblem = contentRootProblem();
    for (const username of usernames) {
      const resolved = resolveCapabilities(username);
      const narrowed: Record<
        string,
        { enabled: boolean; reason?: string; stillSent?: string }
      > = {};
      for (const name of FEATURE_NAMES) {
        const state = resolved[name];
        if (state.enabled === capabilities[name].enabled) continue;
        narrowed[name] = state.enabled
          ? { enabled: true }
          : { enabled: false, reason: state.reason };
        // `mail: { enabled: false }` for a journal is true of its letters to
        // readers and false of everything else, and reporting only the first
        // half was the lie B60 started as: the operator read "off", and
        // sign-in codes kept arriving. Named here rather than left implied,
        // from the same constant the docs quote.
        if (name === "mail" && !state.enabled && capabilities.mail?.enabled) {
          narrowed[name].stillSent = TRANSACTIONAL_MAIL_NOTE;
        }
      }
      if (Object.keys(narrowed).length > 0) journals[username] = narrowed;
    }
  }

  const basemapFault = basemapProblem();

  const healthy = configOk && !contentProblem;

  // Only the journals this instance already advertises, unless the caller is
  // entitled to the rest. See the note above; `listedUsernames()` is the same
  // filter `/documentation.txt` and the sitemap use, so there is one answer to
  // "may this journal's name be handed out" rather than two.
  const listed = detailed ? null : new Set(listedUsernames());
  const shownJournals = listed
    ? Object.fromEntries(Object.entries(journals).filter(([name]) => listed.has(name)))
    : journals;
  const withheld = Object.keys(journals).length - Object.keys(shownJournals).length;

  const body = {
    status: healthy ? "ok" : "error",
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: pkg.version ?? null,
    commit: process.env.GIT_SHA ?? null,
    config: configOk ? { ok: true } : fault("unusable", configError ?? "", detailed),
    // The journal directory itself, separately from the config file inside it.
    // `ok: true` says the list below is the whole truth; `ok: false` says this
    // process cannot see any journal at all, whatever `journals` looks like.
    // That distinction is B197's, and it is public; the path is not.
    content: contentProblem ? fault("unreadable", contentProblem, detailed) : { ok: true },
    // The map data under every trip map, separately again: it is read from
    // lib/, not from content/, and a journal directory that is fine says
    // nothing about a bundle that is not. See the note above on why this does
    // not move `status`.
    basemap: basemapFault ? fault("unreadable", basemapFault, detailed) : { ok: true },
    capabilities,
    journals: shownJournals,
    ...(withheld > 0 ? { journalsWithheld: withheld } : {}),
    backup: readBackupStatus(),
    responseTimeMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
