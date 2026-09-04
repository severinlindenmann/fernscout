import { NextResponse } from "next/server";
import { readBackupStatus } from "@/lib/backupStatus";
import { basemapProblem } from "@/lib/basemap";
import { resolveCapabilities } from "@/lib/capabilities";
import { loadServerConfig } from "@/lib/config";
import { FEATURE_NAMES } from "@/lib/config";
import { TRANSACTIONAL_MAIL_NOTE } from "@/lib/mail/types";
import { contentRootProblem, getUsernames } from "@/lib/users";
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
 */
export async function GET() {
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

  const body = {
    status: healthy ? "ok" : "error",
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: pkg.version ?? null,
    commit: process.env.GIT_SHA ?? null,
    config: configOk ? { ok: true } : { ok: false, error: configError },
    // The journal directory itself, separately from the config file inside it.
    // `ok: true` says the list below is the whole truth; `ok: false` says this
    // process cannot see any journal at all, whatever `journals` looks like.
    content: contentProblem ? { ok: false, error: contentProblem } : { ok: true },
    // The map data under every trip map, separately again: it is read from
    // lib/, not from content/, and a journal directory that is fine says
    // nothing about a bundle that is not. See the note above on why this does
    // not move `status`.
    basemap: basemapFault ? { ok: false, error: basemapFault } : { ok: true },
    capabilities,
    journals,
    backup: readBackupStatus(),
    responseTimeMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
